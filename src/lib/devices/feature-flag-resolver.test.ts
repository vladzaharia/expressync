/**
 * feature-flag-resolver.ts unit tests.
 *
 * Pure-logic tests via the test-seam reader so the suite runs without
 * a DB. Covers the four cases the task spec calls out:
 *
 *   1. Default-omit — when every flag's effective value equals its
 *      registry default, the resolver returns an empty object.
 *   2. User-only value — a user-level row that differs from the
 *      default surfaces in the result.
 *   3. Device override wins — when both user and device rows exist,
 *      the device value wins.
 *   4. Charger devices skip the device-override read — even if a
 *      `device_feature_flag_overrides` row existed, it would not be
 *      consulted (and in practice the schema-level trigger prevents
 *      such a row from being written, but defense in depth).
 */

import { assertEquals } from "@std/assert";
import {
  _resetFeatureFlagResolverTestSeams,
  _setFeatureFlagReaderForTests,
  resolveFlags,
} from "./feature-flag-resolver.ts";

const T0 = new Date("2026-05-01T00:00:00.000Z");
const USER = "user-abc";
const PHONE = "00000000-0000-0000-0000-000000000001";
const CHARGER = "00000000-0000-0000-0000-0000000000aa";

interface FakeReaderState {
  deviceKind?: { kind: string; deletedAt: Date | null } | null;
  userRows?: {
    flagKey: string;
    valueJson: unknown;
    updatedAt: Date;
    updatedBy: string;
  }[];
  deviceRows?: {
    flagKey: string;
    valueJson: unknown;
    updatedAt: Date;
    updatedBy: string;
  }[];
  /** Increments every time loadDeviceFlags is called. */
  deviceLoads: number;
}

function installReader(s: FakeReaderState) {
  _setFeatureFlagReaderForTests({
    loadDeviceKind: (_id) => Promise.resolve(s.deviceKind ?? null),
    loadUserFlags: (_id) => Promise.resolve(s.userRows ?? []),
    loadDeviceFlags: (_id) => {
      s.deviceLoads++;
      return Promise.resolve(s.deviceRows ?? []);
    },
  });
}

Deno.test({
  name:
    "feature-flag-resolver — default-omit: no rows → empty result (every flag at default)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const state: FakeReaderState = {
      deviceKind: { kind: "phone_nfc", deletedAt: null },
      deviceLoads: 0,
    };
    installReader(state);
    try {
      const out = await resolveFlags(USER, PHONE);
      assertEquals(out, {});
    } finally {
      _resetFeatureFlagResolverTestSeams();
    }
  },
});

Deno.test({
  name:
    "feature-flag-resolver — user-only value: user row that differs from default surfaces",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // demo.flag default is `false`; user sets it to `true`.
    const state: FakeReaderState = {
      deviceKind: { kind: "phone_nfc", deletedAt: null },
      userRows: [
        {
          flagKey: "demo.flag",
          valueJson: true,
          updatedAt: T0,
          updatedBy: "admin:adm-1",
        },
      ],
      deviceLoads: 0,
    };
    installReader(state);
    try {
      const out = await resolveFlags(USER, PHONE);
      assertEquals(Object.keys(out), ["demo.flag"]);
      assertEquals(out["demo.flag"].value, true);
      assertEquals(out["demo.flag"].updatedBy, "admin:adm-1");
      assertEquals(out["demo.flag"].updatedAt, T0.toISOString());
    } finally {
      _resetFeatureFlagResolverTestSeams();
    }
  },
});

Deno.test({
  name: "feature-flag-resolver — device override wins over user value",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const T1 = new Date("2026-05-02T00:00:00.000Z");
    const state: FakeReaderState = {
      deviceKind: { kind: "phone_nfc", deletedAt: null },
      userRows: [
        {
          flagKey: "demo.flag",
          valueJson: true,
          updatedAt: T0,
          updatedBy: "admin:adm-1",
        },
      ],
      deviceRows: [
        {
          flagKey: "demo.flag",
          valueJson: false, // back to default — but "device override → equals default → omit"
          updatedAt: T1,
          updatedBy: "admin:adm-2",
        },
      ],
      deviceLoads: 0,
    };
    installReader(state);
    try {
      const out = await resolveFlags(USER, PHONE);
      // Device value `false` equals registry default → omitted.
      assertEquals(out, {});
      assertEquals(state.deviceLoads, 1);
    } finally {
      _resetFeatureFlagResolverTestSeams();
    }
  },
});

Deno.test({
  name:
    "feature-flag-resolver — device override (non-default) wins, carries device provenance",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const T1 = new Date("2026-05-02T00:00:00.000Z");
    const state: FakeReaderState = {
      deviceKind: { kind: "phone_nfc", deletedAt: null },
      userRows: [
        // `customer.connectivityCheck.enabled` default is true; user
        // disables it — but device re-enables (and we want to verify
        // the device row's provenance wins, not just the value).
        {
          flagKey: "customer.connectivityCheck.enabled",
          valueJson: false,
          updatedAt: T0,
          updatedBy: "admin:adm-user",
        },
      ],
      deviceRows: [
        {
          flagKey: "customer.connectivityCheck.enabled",
          valueJson: false, // also disabled at device level
          updatedAt: T1,
          updatedBy: "admin:adm-device",
        },
      ],
      deviceLoads: 0,
    };
    installReader(state);
    try {
      const out = await resolveFlags(USER, PHONE);
      assertEquals(Object.keys(out), [
        "customer.connectivityCheck.enabled",
      ]);
      assertEquals(
        out["customer.connectivityCheck.enabled"].value,
        false,
      );
      // Device-level provenance must win (later timestamp + device admin).
      assertEquals(
        out["customer.connectivityCheck.enabled"].updatedBy,
        "admin:adm-device",
      );
      assertEquals(
        out["customer.connectivityCheck.enabled"].updatedAt,
        T1.toISOString(),
      );
    } finally {
      _resetFeatureFlagResolverTestSeams();
    }
  },
});

Deno.test({
  name:
    "feature-flag-resolver — charger device skips device-override read (uses user value only)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // In production a charger row can't have any
    // device_feature_flag_overrides (trigger blocks INSERT). The
    // resolver still defends in depth: even if the table somehow
    // contained a row for this device, it MUST NOT be read for a
    // charger-kind device.
    const state: FakeReaderState = {
      deviceKind: { kind: "charger", deletedAt: null },
      userRows: [
        {
          flagKey: "demo.flag",
          valueJson: true,
          updatedAt: T0,
          updatedBy: "admin:adm-1",
        },
      ],
      deviceRows: [
        // Should NEVER be read for a charger.
        {
          flagKey: "demo.flag",
          valueJson: false,
          updatedAt: T0,
          updatedBy: "admin:should-not-win",
        },
      ],
      deviceLoads: 0,
    };
    installReader(state);
    try {
      const out = await resolveFlags(USER, CHARGER);
      // User value (true) wins because device override read was skipped.
      assertEquals(out["demo.flag"].value, true);
      assertEquals(out["demo.flag"].updatedBy, "admin:adm-1");
      assertEquals(state.deviceLoads, 0); // never touched
    } finally {
      _resetFeatureFlagResolverTestSeams();
    }
  },
});
