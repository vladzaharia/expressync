/**
 * ExpresScan v2 — admin feature-flags PATCH at the **global** tier.
 *
 * PATCH /api/admin/feature-flags
 *   Body (strict): { flags: Array<{ key: string; value: <json> | null }> }
 *
 * Per entry:
 *   - `value: null` deletes the global row for `key` (falls back to the
 *     registry default unless a per-user or per-device row applies).
 *   - Otherwise the value is validated against the registry's Zod
 *     schema, and the row is upserted with
 *     `updated_by = "admin:{adminUserId}"`.
 *
 * Effective precedence (resolver): device override > user value >
 * **global value** > registry default.
 *
 * Auth: admin cookie. Bearer is rejected upstream.
 *
 * Errors:
 *   401 unauthorized                no cookie session
 *   403 forbidden                   non-admin role
 *   400 invalid_body                Zod failure
 *   400 invalid_flag                unknown key
 *   400 invalid_value               Zod failure for the per-flag value
 *   500 internal_error              storage failure
 */

import { inArray } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { globalFeatureFlagValues } from "../../../src/db/schema.ts";
import {
  FEATURE_FLAGS,
  type FeatureFlag,
  isFeatureFlag,
} from "../../../src/lib/devices/feature-flags.ts";
import { withIdempotency } from "../../../src/lib/idempotency.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("AdminGlobalFeatureFlagsPatch");
const ROUTE = "/api/admin/feature-flags";

const BodySchema = z.object({
  flags: z.array(z.object({
    key: z.string().min(1).max(120),
    value: z.unknown(),
  })).min(1).max(50),
}).strict();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async PATCH(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    if (ctx.state.user.role !== "admin") {
      return jsonResponse(403, { error: "forbidden" });
    }
    const adminUserId = ctx.state.user.id;

    let parsed: z.infer<typeof BodySchema>;
    try {
      const raw = await ctx.req.json();
      parsed = BodySchema.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return jsonResponse(400, {
          error: "invalid_body",
          issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      return jsonResponse(400, { error: "invalid_body" });
    }

    return await withIdempotency(ctx, ROUTE, async () => {
      // De-dup by key, last writer wins.
      const seen = new Map<string, { key: string; value: unknown }>();
      for (const f of parsed.flags) seen.set(f.key, f);

      const upserts: {
        key: FeatureFlag;
        value: unknown;
      }[] = [];
      const deletes: FeatureFlag[] = [];

      for (const f of seen.values()) {
        if (!isFeatureFlag(f.key)) {
          return jsonResponse(400, { error: "invalid_flag", key: f.key });
        }
        const spec = FEATURE_FLAGS[f.key];
        if (f.value === null) {
          deletes.push(f.key);
          continue;
        }
        const result = spec.schema.safeParse(f.value);
        if (!result.success) {
          return jsonResponse(400, {
            error: "invalid_value",
            key: f.key,
            issues: result.error.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          });
        }
        upserts.push({ key: f.key, value: result.data });
      }

      try {
        const updatedAt = new Date();
        const updatedBy = `admin:${adminUserId}`;
        for (const u of upserts) {
          await db
            .insert(globalFeatureFlagValues)
            .values({
              flagKey: u.key,
              valueJson: u.value as never,
              updatedAt,
              updatedBy,
            })
            .onConflictDoUpdate({
              target: globalFeatureFlagValues.flagKey,
              set: {
                valueJson: u.value as never,
                updatedAt,
                updatedBy,
              },
            });
        }
        if (deletes.length > 0) {
          await db
            .delete(globalFeatureFlagValues)
            .where(inArray(globalFeatureFlagValues.flagKey, deletes));
        }

        const changedKeys: FeatureFlag[] = [
          ...upserts.map((u) => u.key),
          ...deletes,
        ];
        log.info("global feature flags updated", {
          adminUserId,
          changedKeys,
        });
        return jsonResponse(200, {
          ok: true,
          changedKeys,
        });
      } catch (err) {
        log.error("global feature-flag write failed", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        return jsonResponse(500, { error: "internal_error" });
      }
    });
  },
});
