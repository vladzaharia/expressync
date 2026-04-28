/**
 * cpsim.ts — TypeScript wrapper around the Go cpsim binary. Spawns the
 * binary as a subprocess, communicates over line-delimited JSON-RPC, and
 * exposes a typed surface to test code.
 */

import { registerCleanup } from "./env.ts";

export interface CpsimEvent {
  seq: number;
  t: number;
  kind: string;
  payload: Record<string, unknown>;
}

export interface AuthorizeResult {
  status: string;
  expiryDate?: string;
  parentIdTag?: string;
}

export interface StartTxResult {
  transactionId: number;
  idTagInfo: { status: string };
}

export class Cpsim {
  private child!: Deno.ChildProcess;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = "";
  private closed = false;
  private enc = new TextEncoder();
  private dec = new TextDecoder();

  // deno-lint-ignore require-await
  static async spawn(binaryPath: string): Promise<Cpsim> {
    const inst = new Cpsim();
    const cmd = new Deno.Command(binaryPath, {
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    inst.child = cmd.spawn();
    inst.writer = inst.child.stdin.getWriter();
    inst.pumpStdout();
    inst.pumpStderr();
    registerCleanup(async () => {
      await inst.dispose();
    });
    return inst;
  }

  private async pumpStdout() {
    const reader = this.child.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += this.dec.decode(value, { stream: true });
        let idx = this.buffer.indexOf("\n");
        while (idx >= 0) {
          const line = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 1);
          this.handleLine(line);
          idx = this.buffer.indexOf("\n");
        }
      }
    } catch { /* ignore */ }
  }

  private async pumpStderr() {
    const reader = this.child.stderr.getReader();
    const dec = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value);
        if (Deno.env.get("CPSIM_DEBUG")) {
          console.error("[cpsim stderr]", text.trimEnd());
        }
      }
    } catch { /* ignore */ }
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let msg: { id: number; result?: unknown; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const w = this.pending.get(msg.id);
    if (!w) return;
    this.pending.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error));
    else w.resolve(msg.result);
  }

  private call<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("cpsim closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.writer.write(this.enc.encode(payload)).catch(reject);
      // Hard timeout per RPC.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`cpsim ${method} timed out`));
        }
      }, 30_000);
    });
  }

  connect(url: string, chargeBoxId: string) {
    return this.call<{ connected: boolean }>("connect", { url, chargeBoxId });
  }
  bootNotification(model = "cpsim", vendor = "ExpresSyncTest") {
    return this.call<{ status: string; interval: number }>("bootNotification", {
      model,
      vendor,
    });
  }
  statusNotification(
    connectorId: number,
    status = "Available",
    errorCode = "NoError",
  ) {
    return this.call<{ ok: boolean }>("statusNotification", {
      connectorId,
      status,
      errorCode,
    });
  }
  authorize(idTag: string) {
    return this.call<AuthorizeResult>("authorize", { idTag });
  }
  startTransaction(connectorId: number, idTag: string, meterStart = 0) {
    return this.call<StartTxResult>("startTransaction", {
      connectorId,
      idTag,
      meterStart,
    });
  }
  stopTransaction(transactionId: number, meterStop = 0) {
    return this.call<{ idTagStatus: string }>("stopTransaction", {
      transactionId,
      meterStop,
    });
  }
  heartbeat() {
    return this.call<{ currentTime: string }>("heartbeat");
  }
  events(since = 0) {
    return this.call<CpsimEvent[]>("events", { since });
  }
  lastAuthorizeStatus() {
    return this.call<{ status: string }>("lastAuthorizeStatus");
  }
  disconnect() {
    return this.call<{ ok: boolean }>("disconnect");
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.disconnect();
    } catch { /* */ }
    try {
      await this.writer.close();
    } catch { /* */ }
    try {
      this.child.kill("SIGTERM");
    } catch { /* */ }
    try {
      await this.child.status;
    } catch { /* */ }
  }
}
