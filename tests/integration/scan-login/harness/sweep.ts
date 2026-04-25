/**
 * sweep.ts — finds and tears down orphaned scan-login test stacks.
 *
 * A stack is considered orphaned when:
 *   - its runner PID label is missing, or
 *   - the runner PID is no longer alive on this host, or
 *   - it is older than MAX_AGE_MS (a stuck run that outlived its own
 *     wallclock budget — at that point the runner is either hung or has
 *     already moved on).
 *
 * Designed to run in two contexts:
 *   1. As the first step inside runner.ts, so each fresh test run
 *      self-heals leftovers from previous crashes / kills / OOMs.
 *   2. Standalone via `deno task scanlogin:sweep` for manual or cron use.
 *
 * Pure introspection until the final teardown, so it's safe to run
 * concurrently with live tests — live runs are skipped (their PID is
 * alive AND they're younger than the cutoff).
 */

import { forceTeardown } from "./compose.ts";

const PROJECT_PREFIX = "scanlogin-";
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour — a real test run never exceeds this.

interface ProjectInfo {
  project: string;
  runnerPid: number | null;
  startedAt: number | null;
  containerCount: number;
}

async function dockerOut(args: string[]): Promise<string> {
  const cmd = new Deno.Command("docker", {
    args,
    stdout: "piped",
    stderr: "null",
  });
  const out = await cmd.output();
  return new TextDecoder().decode(out.stdout);
}

async function listProjects(): Promise<ProjectInfo[]> {
  // `docker ps -a --filter label=...` returns one row per container; we
  // group by compose project and pick labels off any one container in
  // the group (they're identical within a project).
  const fmt = '{{.Label "com.docker.compose.project"}}\t' +
    '{{.Label "com.expressync.scanlogin.runner-pid"}}\t' +
    '{{.Label "com.expressync.scanlogin.started-at"}}';
  const out = await dockerOut([
    "ps",
    "-a",
    "--filter",
    "label=com.expressync.scanlogin.harness=true",
    "--format",
    fmt,
  ]);
  const groups = new Map<string, ProjectInfo>();
  for (const line of out.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [project, pidStr, startedStr] = line.split("\t");
    if (!project || !project.startsWith(PROJECT_PREFIX)) continue;
    const existing = groups.get(project);
    if (existing) {
      existing.containerCount++;
      continue;
    }
    groups.set(project, {
      project,
      runnerPid: pidStr && /^\d+$/.test(pidStr) ? parseInt(pidStr, 10) : null,
      startedAt: startedStr && /^\d+$/.test(startedStr)
        ? parseInt(startedStr, 10)
        : null,
      containerCount: 1,
    });
  }
  // Also include orphan networks/volumes whose containers are already
  // gone — their compose project may have no running containers but
  // still have a network we need to reap.
  const netOut = await dockerOut([
    "network",
    "ls",
    "--filter",
    "label=com.expressync.scanlogin.harness=true",
    "--format",
    '{{.Label "com.docker.compose.project"}}',
  ]);
  for (
    const project of netOut.split("\n").map((l) => l.trim()).filter(Boolean)
  ) {
    if (!project.startsWith(PROJECT_PREFIX)) continue;
    if (!groups.has(project)) {
      groups.set(project, {
        project,
        runnerPid: null,
        startedAt: null,
        containerCount: 0,
      });
    }
  }
  return [...groups.values()];
}

/** Linux-only PID liveness check via /proc. Cheap and dependency-free. */
function isPidAlive(pid: number): boolean {
  try {
    Deno.statSync(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

interface Verdict {
  orphan: boolean;
  reason: string;
}

function classify(p: ProjectInfo, excludePid: number | null): Verdict {
  if (excludePid !== null && p.runnerPid === excludePid) {
    return { orphan: false, reason: "current runner" };
  }
  if (p.runnerPid === null) {
    return { orphan: true, reason: "no runner-pid label" };
  }
  if (!isPidAlive(p.runnerPid)) {
    return { orphan: true, reason: `pid ${p.runnerPid} dead` };
  }
  if (p.startedAt !== null && Date.now() - p.startedAt > MAX_AGE_MS) {
    const ageMin = Math.round((Date.now() - p.startedAt) / 60000);
    return {
      orphan: true,
      reason: `age ${ageMin}m exceeds cutoff (pid ${p.runnerPid} likely hung)`,
    };
  }
  return { orphan: false, reason: `pid ${p.runnerPid} alive` };
}

export interface SweepOptions {
  /** Don't tear down a project tagged with this PID (the current runner). */
  excludePid?: number;
  /** If true, log decisions to stderr. */
  verbose?: boolean;
}

export interface SweepResult {
  inspected: number;
  orphans: string[];
  preserved: string[];
}

export async function sweepOrphans(
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const projects = await listProjects();
  const orphans: string[] = [];
  const preserved: string[] = [];
  for (const p of projects) {
    const verdict = classify(p, opts.excludePid ?? null);
    if (opts.verbose) {
      console.error(
        `[sweep] ${p.project}: ${
          verdict.orphan ? "orphan" : "keep"
        } (${verdict.reason})`,
      );
    }
    if (verdict.orphan) orphans.push(p.project);
    else preserved.push(p.project);
  }
  // Tear orphans down in parallel — they're independent projects.
  await Promise.all(orphans.map(async (project) => {
    try {
      await forceTeardown(project);
      if (opts.verbose) console.error(`[sweep] tore down ${project}`);
    } catch (err) {
      console.error(`[sweep] failed to tear down ${project}:`, err);
    }
  }));
  return { inspected: projects.length, orphans, preserved };
}

// CLI entrypoint: `deno run -A sweep.ts`
if (import.meta.main) {
  const result = await sweepOrphans({ verbose: true });
  console.error(
    `[sweep] done: inspected=${result.inspected} reaped=${result.orphans.length} preserved=${result.preserved.length}`,
  );
}
