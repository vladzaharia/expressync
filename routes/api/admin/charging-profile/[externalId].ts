/**
 * Phase P5 — Charging Profile API
 *
 * GET    /api/charging-profile/[externalId]  → current profile (or defaults)
 * POST   /api/charging-profile/[externalId]  → upsert { preset, windows?, maxWGlobal?, applyNow? }
 * DELETE /api/charging-profile/[externalId]  → alias for upsert({ preset: 'unlimited' })
 */

import { define } from "../../../../utils.ts";
import { z } from "zod";
import {
  clearProfile,
  getProfile,
  presetLabel,
  upsertProfile,
} from "../../../../src/services/charging-profile.service.ts";
import type {
  ChargingProfilePreset,
  ChargingWindow,
} from "../../../../src/db/schema.ts";

const PRESET_VALUES = [
  "unlimited",
  "offpeak",
  "cap7kw",
  "cap11kw",
  "solar",
  "custom",
] as const;

const WindowSchema: z.ZodType<ChargingWindow> = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
  maxW: z.number().int().positive().optional(),
}).refine((w) => w.endMin > w.startMin, {
  message: "endMin must be greater than startMin",
});

const UpsertBodySchema = z.object({
  preset: z.enum(PRESET_VALUES),
  windows: z.array(WindowSchema).optional(),
  maxWGlobal: z.number().int().positive().nullable().optional(),
  applyNow: z.boolean().optional(),
});

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    const externalId = ctx.params.externalId;
    if (!externalId) {
      return jsonResponse({ error: "Missing externalId" }, { status: 400 });
    }
    const profile = await getProfile(externalId);
    return jsonResponse({
      profile,
      label: presetLabel(profile),
      // DTO consumed by sibling Link-detail chip
      chargingProfileHref: `/subscriptions/${
        encodeURIComponent(externalId)
      }/profile`,
      chargingProfileLabel: profile ? presetLabel(profile) : "Not configured",
    });
  },

  async POST(ctx) {
    const externalId = ctx.params.externalId;
    if (!externalId) {
      return jsonResponse({ error: "Missing externalId" }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = UpsertBodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const userId = ctx.state.user?.id ?? null;
    const result = await upsertProfile({
      lagoSubscriptionExternalId: externalId,
      preset: parsed.data.preset as ChargingProfilePreset,
      windows: parsed.data.windows,
      maxWGlobal: parsed.data.maxWGlobal ?? null,
      applyNow: parsed.data.applyNow,
      userId,
    });
    return jsonResponse({
      profile: result.profile,
      label: presetLabel(result.profile),
      lagoMirrorOk: result.lagoMirrorOk,
      lagoMirrorError: result.lagoMirrorError ?? null,
    }, { status: 200 });
  },

  async DELETE(ctx) {
    const externalId = ctx.params.externalId;
    if (!externalId) {
      return jsonResponse({ error: "Missing externalId" }, { status: 400 });
    }
    const userId = ctx.state.user?.id ?? null;
    const result = await clearProfile(externalId, userId);
    return jsonResponse({
      profile: result.profile,
      label: presetLabel(result.profile),
      lagoMirrorOk: result.lagoMirrorOk,
      lagoMirrorError: result.lagoMirrorError ?? null,
    });
  },
});
