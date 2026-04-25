/**
 * ReservationWizard — 5-step booking flow.
 *
 * Steps:
 *   1. Charger  — lightweight grid picker (LOCAL; does NOT reuse ChargerCard)
 *   2. Connector — auto-skipped when the charger has only one
 *   3. Tag      — tag chooser (filterable list)
 *   4. Window   — start + duration; inline conflict detection via service
 *   5. Review   — final confirmation, submits POST /api/reservations
 *
 * State persists to the URL query so a page refresh never loses progress.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  BatteryCharging,
  Check,
  Loader2,
  Pencil,
  Plug,
  Tag as TagIcon,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ConflictWarning } from "@/components/reservations/ConflictWarning.tsx";
import { TimeRangePill } from "@/components/reservations/TimeRangePill.tsx";
import {
  DateTimeRangePicker,
  type PickerConflict,
} from "@/components/reservations/DateTimeRangePicker.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import type { ReservationStatus } from "@/src/db/schema.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

export interface WizardChargerOption {
  chargeBoxId: string;
  friendlyName: string | null;
  /** Count of connectors; drives whether step 2 is auto-skipped. */
  connectorCount: number;
  /** Known connector ids; `[0]` when unknown (charger-wide). */
  connectorIds: number[];
  lastStatus: string | null;
}

export interface WizardTagOption {
  ocppTagPk: number;
  idTag: string;
  displayName: string | null;
  lagoSubscriptionExternalId: string | null;
}

interface WizardConflict {
  id: number;
  startAtIso: string;
  endAtIso: string;
  status: ReservationStatus;
  steveOcppIdTag: string;
}

interface Props {
  chargers: WizardChargerOption[];
  tags: WizardTagOption[];
  /** Optional preselections (from query string). */
  initial?: {
    chargeBoxId?: string | null;
    connectorId?: number | null;
    ocppTagPk?: number | null;
    startAtIso?: string | null;
    durationMinutes?: number | null;
  };
  /** Optional IANA tz used for inline display. */
  displayTz?: string | null;
  /**
   * API endpoint for the create POST. Defaults to the admin endpoint so
   * existing callers (`routes/admin/reservations/new.tsx`) keep working.
   * Customer surface passes `/api/customer/reservations`.
   */
  submitUrl?: string;
  /**
   * Conflict-check endpoint used by the inline conflict effect. Defaults
   * to `/api/admin/reservations` for admin parity. Customer surface passes
   * `/api/customer/reservations`.
   */
  conflictCheckUrl?: string;
  /**
   * Path prefix for the post-create redirect. Defaults to `/reservations`
   * so admin URLs (e.g. `/reservations/123` after middleware rewrite) and
   * customer URLs (`/reservations/123` directly) both work.
   */
  redirectPathPrefix?: string;
  /**
   * When true, applies a brief celebration animation (SparklesText on the
   * page title) after successful create — used by the customer wizard.
   */
  celebrateOnSuccess?: boolean;
}

const STEP_LABELS = [
  "Charger",
  "Connector",
  "Tag",
  "Time",
  "Review",
] as const;

const DEFAULT_DURATION = 60;

function isoAt(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function parseLocalDatetime(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function ReservationWizard(
  {
    chargers,
    tags,
    initial,
    displayTz,
    submitUrl = "/api/admin/reservations",
    conflictCheckUrl = "/api/admin/reservations",
    redirectPathPrefix = "/reservations",
    celebrateOnSuccess: _celebrateOnSuccess = false,
  }: Props,
) {
  // Hydrate from URL on mount so a refresh doesn't lose progress.
  const [step, setStep] = useState<number>(0);
  const [chargeBoxId, setChargeBoxId] = useState<string | null>(
    initial?.chargeBoxId ?? null,
  );
  const [connectorId, setConnectorId] = useState<number | null>(
    initial?.connectorId ?? null,
  );
  const [ocppTagPk, setOcppTagPk] = useState<number | null>(
    initial?.ocppTagPk ?? null,
  );
  const [tagFilter, setTagFilter] = useState("");
  const [startLocal, setStartLocal] = useState<string>(() => {
    if (initial?.startAtIso) {
      const d = new Date(initial.startAtIso);
      if (!Number.isNaN(d.getTime())) return isoAt(d);
    }
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    d.setMinutes(d.getMinutes() + 30);
    return isoAt(d);
  });
  const [duration, setDuration] = useState<number>(
    initial?.durationMinutes ?? DEFAULT_DURATION,
  );
  const [conflicts, setConflicts] = useState<WizardConflict[]>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedCharger = useMemo(
    () => chargers.find((c) => c.chargeBoxId === chargeBoxId) ?? null,
    [chargers, chargeBoxId],
  );

  const selectedTag = useMemo(
    () => tags.find((t) => t.ocppTagPk === ocppTagPk) ?? null,
    [tags, ocppTagPk],
  );

  const filteredTags = useMemo(() => {
    const q = tagFilter.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) =>
      t.idTag.toLowerCase().includes(q) ||
      (t.displayName ?? "").toLowerCase().includes(q)
    );
  }, [tags, tagFilter]);

  // Auto-skip step 0 (Charger) when only one charger is available — common
  // friends-and-family deployment. The user lands directly on Connector
  // (which itself auto-skips when there's a single connector).
  useEffect(() => {
    if (step !== 0) return;
    if (chargers.length === 1 && chargeBoxId === null) {
      const only = chargers[0];
      setChargeBoxId(only.chargeBoxId);
      // Mirror StepCharger's onSelect side-effect.
      setConnectorId(null);
      setStep(1);
    }
  }, [step, chargers, chargeBoxId]);

  // Auto-skip step 1 (Connector) when the charger has a single connector.
  useEffect(() => {
    if (!selectedCharger) return;
    if (step !== 1) return;
    if (selectedCharger.connectorCount <= 1) {
      setConnectorId(selectedCharger.connectorIds[0] ?? 0);
      setStep(2);
    }
  }, [step, selectedCharger]);

  // Auto-skip step 2 (Tag) when only one tag is available — usually the
  // case for customers since `tags` is pre-filtered to their own cards.
  useEffect(() => {
    if (step !== 2) return;
    if (tags.length === 1 && ocppTagPk === null) {
      setOcppTagPk(tags[0].ocppTagPk);
      setStep(3);
    }
  }, [step, tags, ocppTagPk]);

  // URL-query persistence.
  useEffect(() => {
    if (typeof globalThis.location === "undefined") return;
    const u = new URL(globalThis.location.href);
    const setOrDelete = (k: string, v: string | null) => {
      if (v === null || v === "") u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    };
    setOrDelete("step", String(step));
    setOrDelete("chargeBoxId", chargeBoxId);
    setOrDelete(
      "connectorId",
      connectorId !== null ? String(connectorId) : null,
    );
    setOrDelete("ocppTagPk", ocppTagPk !== null ? String(ocppTagPk) : null);
    setOrDelete("start", startLocal);
    setOrDelete("duration", String(duration));
    globalThis.history.replaceState({}, "", u.toString());
  }, [step, chargeBoxId, connectorId, ocppTagPk, startLocal, duration]);

  // Hydrate from URL on first mount (step override, etc).
  useEffect(() => {
    if (typeof globalThis.location === "undefined") return;
    const u = new URL(globalThis.location.href);
    const raw = u.searchParams.get("step");
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 4) setStep(n);
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inline conflict check whenever the user is on step 4 and has enough data.
  useEffect(() => {
    if (step !== 3) return;
    if (!chargeBoxId) return;
    const startAt = parseLocalDatetime(startLocal);
    if (!startAt) return;
    const endAt = new Date(startAt.getTime() + duration * 60_000);
    const connector = connectorId ?? selectedCharger?.connectorIds[0] ?? 0;

    const ac = new AbortController();
    let cancelled = false;
    setCheckingConflicts(true);
    (async () => {
      try {
        const params = new URLSearchParams({
          chargeBoxId,
          upcoming: "true",
          status: "pending,confirmed,active",
          limit: "100",
        });
        const res = await fetch(
          `${conflictCheckUrl}?${params.toString()}`,
          {
            signal: ac.signal,
          },
        );
        if (!res.ok) {
          if (!cancelled) setConflicts([]);
          return;
        }
        // Both admin and customer endpoints return `{ reservations: [...] }`
        // with the `ReservationRowDTO` shape (per `toReservationRowDTO`).
        const body = await res.json() as {
          reservations: Array<{
            id: number;
            chargeBoxId: string;
            connectorId: number;
            startAtIso: string;
            endAtIso: string;
            status: ReservationStatus;
            ocppTagId: string;
          }>;
        };
        const overlaps: WizardConflict[] = [];
        for (const r of body.reservations) {
          if (r.chargeBoxId !== chargeBoxId) continue;
          if (
            connector !== 0 && r.connectorId !== 0 &&
            r.connectorId !== connector
          ) {
            continue;
          }
          const rs = new Date(r.startAtIso).getTime();
          const re = new Date(r.endAtIso).getTime();
          if (rs < endAt.getTime() && re > startAt.getTime()) {
            overlaps.push({
              id: r.id,
              startAtIso: r.startAtIso,
              endAtIso: r.endAtIso,
              status: r.status,
              steveOcppIdTag: r.ocppTagId,
            });
          }
        }
        if (!cancelled) setConflicts(overlaps);
      } catch (_err) {
        // Ignore abort.
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [step, chargeBoxId, connectorId, startLocal, duration, selectedCharger]);

  const canProceed = (() => {
    if (step === 0) return !!chargeBoxId;
    if (step === 1) return connectorId !== null;
    if (step === 2) return ocppTagPk !== null;
    if (step === 3) {
      return !!parseLocalDatetime(startLocal) && duration > 0 &&
        conflicts.length === 0;
    }
    return true;
  })();

  const submit = async () => {
    if (!selectedCharger || !selectedTag) return;
    const startAt = parseLocalDatetime(startLocal);
    if (!startAt) return;
    const endAt = new Date(startAt.getTime() + duration * 60_000);

    setSubmitting(true);
    try {
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId: selectedCharger.chargeBoxId,
          connectorId: connectorId ?? selectedCharger.connectorIds[0] ?? 0,
          steveOcppTagPk: selectedTag.ocppTagPk,
          steveOcppIdTag: selectedTag.idTag,
          lagoSubscriptionExternalId: selectedTag.lagoSubscriptionExternalId,
          startAtIso: startAt.toISOString(),
          endAtIso: endAt.toISOString(),
        }),
      });

      if (res.status === 201) {
        const body = await res.json() as { reservation: { id: number } };
        toast.success("Reservation created");
        // Brief celebration on the customer surface — for now we just rely
        // on the toast to set the mood while we navigate. The detail page
        // can layer richer UI later (e.g. SparklesText on the title).
        clientNavigate(`${redirectPathPrefix}/${body.reservation.id}${
            _celebrateOnSuccess ? "?celebrate=1" : ""
          }`);
        return;
      }
      if (res.status === 409) {
        const body = await res.json() as { conflicts?: WizardConflict[] };
        setConflicts(body.conflicts ?? []);
        setStep(3);
        toast.error("Time window conflicts with existing reservation(s)");
        return;
      }
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? `Failed to create reservation (${res.status})`);
    } catch (_err) {
      toast.error("Failed to create reservation");
    } finally {
      setSubmitting(false);
    }
  };

  const onPickSuggestion = (startIso: string) => {
    const d = new Date(startIso);
    setStartLocal(isoAt(d));
  };

  const startAtDate = parseLocalDatetime(startLocal);
  const endAtDate = startAtDate
    ? new Date(startAtDate.getTime() + duration * 60_000)
    : null;

  return (
    <div class="flex flex-col gap-6">
      {/* Step rail */}
      <ol class="flex flex-wrap items-center gap-2 text-xs">
        {STEP_LABELS.map((label, idx) => {
          const state = idx < step
            ? "done"
            : idx === step
            ? "current"
            : "upcoming";
          return (
            <li key={label} class="flex items-center gap-2">
              <span
                class={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium",
                  state === "done" &&
                    "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
                  state === "current" &&
                    "border-indigo-500 bg-indigo-500/20 text-indigo-700 dark:text-indigo-300",
                  state === "upcoming" &&
                    "border-border text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  class={cn(
                    "size-1.5 rounded-full",
                    state === "done"
                      ? "bg-indigo-600"
                      : state === "current"
                      ? "bg-indigo-500"
                      : "bg-muted-foreground/50",
                  )}
                />
                {idx + 1}. {label}
              </span>
              {idx < STEP_LABELS.length - 1 && (
                <span aria-hidden="true" class="text-muted-foreground">→</span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Step content */}
      {step === 0 && (
        <StepCharger
          chargers={chargers}
          selected={chargeBoxId}
          onSelect={(id) => {
            setChargeBoxId(id);
            setConnectorId(null);
          }}
        />
      )}

      {step === 1 && selectedCharger && (
        <StepConnector
          charger={selectedCharger}
          selected={connectorId}
          onSelect={setConnectorId}
        />
      )}

      {step === 2 && (
        <StepTag
          tags={filteredTags}
          totalTags={tags.length}
          filter={tagFilter}
          onFilterChange={setTagFilter}
          selected={ocppTagPk}
          onSelect={setOcppTagPk}
        />
      )}

      {step === 3 && selectedCharger && (
        <div class="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:divide-x lg:divide-border">
          <WizardContextAside
            charger={selectedCharger}
            connectorId={connectorId}
            tag={selectedTag ?? null}
            onEditStep={setStep}
          />
          <div class="lg:pl-6">
            <StepWindow
              startAtDate={startAtDate}
              endAtDate={endAtDate}
              onRangeChange={(startAt, endAt) => {
                setStartLocal(isoAt(startAt));
                const newDuration = Math.max(
                  15,
                  Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
                );
                setDuration(newDuration);
              }}
              checking={checkingConflicts}
              conflicts={conflicts}
              onPickSuggestion={onPickSuggestion}
              tz={displayTz ?? null}
            />
          </div>
        </div>
      )}

      {step === 4 && selectedCharger && selectedTag && startAtDate &&
        endAtDate && (
        <StepReview
          charger={selectedCharger}
          connectorId={connectorId ?? selectedCharger.connectorIds[0] ?? 0}
          tag={selectedTag}
          startAtIso={startAtDate.toISOString()}
          endAtIso={endAtDate.toISOString()}
          duration={duration}
          tz={displayTz ?? null}
        />
      )}

      {/* Nav */}
      <div class="flex items-center justify-between gap-3 border-t pt-4">
        <Button
          variant="outline"
          disabled={step === 0 || submitting}
          onClick={() => setStep(Math.max(0, step - 1))}
        >
          <ArrowLeft class="mr-2 size-4" /> Back
        </Button>
        {step < 4 && (
          <Button
            disabled={!canProceed || submitting}
            onClick={() => {
              // Jump over the connector step if the charger has one only.
              if (
                step === 0 && selectedCharger &&
                selectedCharger.connectorCount <= 1
              ) {
                setConnectorId(selectedCharger.connectorIds[0] ?? 0);
                setStep(2);
              } else {
                setStep(Math.min(4, step + 1));
              }
            }}
          >
            Next <ArrowRight class="ml-2 size-4" />
          </Button>
        )}
        {step === 4 && (
          <Button
            disabled={submitting}
            onClick={submit}
            class="bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {submitting
              ? (
                <>
                  <Loader2 class="mr-2 size-4 animate-spin" /> Creating…
                </>
              )
              : (
                <>
                  <Check class="mr-2 size-4" /> Create reservation
                </>
              )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step components (local; no external state)
// ---------------------------------------------------------------------------

function StepCharger(
  { chargers, selected, onSelect }: {
    chargers: WizardChargerOption[];
    selected: string | null;
    onSelect: (id: string) => void;
  },
) {
  if (chargers.length === 0) {
    return (
      <div class="rounded-md border border-dashed bg-muted/20 px-6 py-8 text-center text-sm text-muted-foreground">
        No chargers known yet. Add one via{" "}
        <a href="/chargers" class="underline">Chargers</a> and return here.
      </div>
    );
  }
  return (
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {chargers.map((c) => (
        <button
          key={c.chargeBoxId}
          type="button"
          onClick={() => onSelect(c.chargeBoxId)}
          aria-pressed={selected === c.chargeBoxId}
          class={cn(
            "flex items-center gap-3 rounded-md border bg-background px-3 py-3 text-left transition-colors hover:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/50",
            selected === c.chargeBoxId &&
              "border-indigo-500 bg-indigo-500/5",
          )}
        >
          <BatteryCharging class="size-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">
              {c.friendlyName ?? c.chargeBoxId}
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {c.chargeBoxId} · {c.connectorCount}{" "}
              connector{c.connectorCount !== 1 ? "s" : ""}
              {c.lastStatus ? ` · ${c.lastStatus}` : ""}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function StepConnector(
  { charger, selected, onSelect }: {
    charger: WizardChargerOption;
    selected: number | null;
    onSelect: (id: number) => void;
  },
) {
  const options = charger.connectorIds.length > 0 ? charger.connectorIds : [0];
  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted-foreground">
        Pick a connector on{" "}
        {charger.friendlyName ?? charger.chargeBoxId}. Connector <code>0</code>
        {" "}
        reserves the entire charger.
      </p>
      <div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {options.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={selected === id}
            class={cn(
              "rounded-md border bg-background px-3 py-3 text-center text-sm transition-colors hover:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/50",
              selected === id && "border-indigo-500 bg-indigo-500/5",
            )}
          >
            <div class="text-lg font-semibold">#{id}</div>
            <div class="text-xs text-muted-foreground">
              {id === 0 ? "All connectors" : "Connector"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepTag(
  { tags, totalTags, filter, onFilterChange, selected, onSelect }: {
    tags: WizardTagOption[];
    totalTags: number;
    filter: string;
    onFilterChange: (v: string) => void;
    selected: number | null;
    onSelect: (pk: number) => void;
  },
) {
  return (
    <div class="flex flex-col gap-3">
      <Label htmlFor="reservation-tag-filter">Pick an OCPP tag</Label>
      <Input
        id="reservation-tag-filter"
        type="search"
        placeholder={`Filter ${totalTags} tag${totalTags !== 1 ? "s" : ""}…`}
        value={filter}
        onInput={(e) => onFilterChange((e.target as HTMLInputElement).value)}
      />
      {tags.length === 0 && (
        <div class="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          No tags match the filter.
        </div>
      )}
      <ul class="max-h-80 overflow-auto rounded-md border divide-y">
        {tags.map((t) => (
          <li key={t.ocppTagPk}>
            <button
              type="button"
              onClick={() => onSelect(t.ocppTagPk)}
              aria-pressed={selected === t.ocppTagPk}
              class={cn(
                "flex w-full items-center justify-between gap-3 bg-background px-3 py-2 text-left transition-colors hover:bg-indigo-500/5",
                selected === t.ocppTagPk && "bg-indigo-500/10",
              )}
            >
              <span class="flex items-center gap-2 min-w-0">
                <TagIcon class="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                <span class="min-w-0 truncate font-mono text-sm">
                  {t.idTag}
                </span>
                {t.displayName && (
                  <span class="truncate text-xs text-muted-foreground">
                    ({t.displayName})
                  </span>
                )}
              </span>
              {t.lagoSubscriptionExternalId && (
                <span class="hidden text-[10px] uppercase text-muted-foreground sm:inline">
                  sub linked
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepWindow(
  {
    startAtDate,
    endAtDate,
    onRangeChange,
    checking,
    conflicts,
    onPickSuggestion,
    tz,
  }: {
    startAtDate: Date | null;
    endAtDate: Date | null;
    onRangeChange: (startAt: Date, endAt: Date) => void;
    checking: boolean;
    conflicts: WizardConflict[];
    onPickSuggestion: (iso: string) => void;
    tz: string | null;
  },
) {
  const pickerConflicts: PickerConflict[] = conflicts.map((c) => ({
    id: c.id,
    startAtIso: c.startAtIso,
    endAtIso: c.endAtIso,
  }));
  const value = startAtDate && endAtDate
    ? { startAt: startAtDate, endAt: endAtDate }
    : null;
  return (
    <div class="flex flex-col gap-4">
      <DateTimeRangePicker
        value={value}
        onChange={(next) => onRangeChange(next.startAt, next.endAt)}
        tz={tz ?? undefined}
        minuteStep={15}
        conflicts={pickerConflicts}
        loadingConflicts={checking}
        variant="inline"
        minDate={new Date()}
        idPrefix="wizard"
      />
      <ConflictWarning
        conflicts={conflicts}
        tz={tz ?? undefined}
        onPickSuggestion={onPickSuggestion}
      />
    </div>
  );
}

/**
 * Summary aside shown on the left of the Window step — three small cards
 * (charger, connector, tag) with icons and inline "Edit" jumps so operators
 * don't lose sight of the choices they already made while picking a time.
 * The outer grid provides the vertical divider between aside and picker.
 */
function WizardContextAside(
  { charger, connectorId, tag, onEditStep }: {
    charger: WizardChargerOption;
    connectorId: number | null;
    tag: WizardTagOption | null;
    onEditStep: (step: number) => void;
  },
) {
  return (
    <aside class="flex flex-col gap-3 h-fit lg:sticky lg:top-4 lg:pr-6">
      <ContextCard
        icon={BatteryCharging}
        iconTone="bg-orange-500/10 text-orange-600 dark:text-orange-400"
        label="Charger"
        value={charger.friendlyName ?? charger.chargeBoxId}
        subValue={charger.friendlyName ? charger.chargeBoxId : undefined}
        onEdit={() => onEditStep(0)}
      />
      <ContextCard
        icon={Plug}
        iconTone="bg-blue-500/10 text-blue-600 dark:text-blue-400"
        label="Connector"
        value={connectorId == null
          ? <span class="italic text-muted-foreground">Not chosen</span>
          : connectorId === 0
          ? "All connectors"
          : `Connector #${connectorId}`}
        onEdit={() => onEditStep(1)}
      />
      <ContextCard
        icon={TagIcon}
        iconTone="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
        label="Tag"
        value={tag
          ? (tag.displayName ?? tag.idTag)
          : <span class="italic text-muted-foreground">Not chosen</span>}
        subValue={tag && tag.displayName ? tag.idTag : undefined}
        onEdit={() => onEditStep(2)}
      />
    </aside>
  );
}

function ContextCard(
  { icon: Icon, iconTone, label, value, subValue, onEdit }: {
    icon: typeof BatteryCharging;
    iconTone: string;
    label: string;
    value: preact.ComponentChildren;
    subValue?: string;
    onEdit: () => void;
  },
) {
  return (
    <div class="flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm">
      <span
        class={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          iconTone,
        )}
        aria-hidden="true"
      >
        <Icon class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <button
            type="button"
            onClick={onEdit}
            class="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            aria-label={`Edit ${label.toLowerCase()}`}
          >
            <Pencil class="size-3" aria-hidden="true" />
            Edit
          </button>
        </div>
        <p class="mt-0.5 truncate text-sm font-medium text-foreground">
          {value}
        </p>
        {subValue && (
          <p class="truncate font-mono text-[11px] text-muted-foreground">
            {subValue}
          </p>
        )}
      </div>
    </div>
  );
}

function StepReview(
  { charger, connectorId, tag, startAtIso, endAtIso, duration, tz }: {
    charger: WizardChargerOption;
    connectorId: number;
    tag: WizardTagOption;
    startAtIso: string;
    endAtIso: string;
    duration: number;
    tz: string | null;
  },
) {
  return (
    <div class="rounded-md border bg-background">
      <dl class="grid gap-3 p-4 text-sm sm:grid-cols-2">
        <Row
          term="Charger"
          value={charger.friendlyName ?? charger.chargeBoxId}
        />
        <Row
          term="Connector"
          value={connectorId === 0 ? "All (charger-wide)" : `#${connectorId}`}
        />
        <Row term="Tag" value={tag.displayName ?? tag.idTag} hint={tag.idTag} />
        <Row
          term="Subscription"
          value={tag.lagoSubscriptionExternalId ?? "—"}
        />
        <Row
          term="Window"
          value={
            <TimeRangePill
              startAtIso={startAtIso}
              endAtIso={endAtIso}
              tz={tz ?? undefined}
            />
          }
        />
        <Row term="Duration" value={`${duration} min`} />
      </dl>
    </div>
  );
}

function Row(
  { term, value, hint }: {
    term: string;
    value: preact.ComponentChildren;
    hint?: string;
  },
) {
  return (
    <div class="flex flex-col">
      <dt class="text-xs uppercase tracking-wide text-muted-foreground">
        {term}
      </dt>
      <dd class="text-sm font-medium text-foreground">{value}</dd>
      {hint && (
        <span class="font-mono text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
