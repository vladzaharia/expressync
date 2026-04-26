/**
 * Operation audit log for `/chargers/[chargeBoxId]`.
 *
 * Server sends the initial page; this island hosts the expand-row accordion
 * behavior and a `Re-run` shortcut that dispatches the same
 * `charger:open-action` event `ConnectorCard` uses, so `RemoteActionsPanel`
 * pre-fills with the failed op's params.
 */

import { useState } from "preact/hooks";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { formatRelative } from "./shared/device-visuals.ts";
import type { OcppOperationName } from "@/src/lib/types/steve.ts";

export interface OperationLogRow {
  id: number;
  operation: OcppOperationName;
  params: Record<string, unknown> | null;
  status: string;
  taskId: number | null;
  result: Record<string, unknown> | null;
  requestedByEmail: string | null;
  requestedAtIso: string;
  completedAtIso: string | null;
}

interface Props {
  rows: OperationLogRow[];
  isAdmin: boolean;
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  switch (status) {
    case "success":
    case "completed":
      return "success";
    case "failed":
    case "timeout":
      return "destructive";
    case "dry_run":
      return "secondary";
    case "submitted":
    case "pending":
      return "warning";
    default:
      return "outline";
  }
}

function rerun(op: OcppOperationName, params: Record<string, unknown> | null) {
  const evt = new CustomEvent("charger:open-action", {
    detail: { operation: op, params: params ?? {} },
  });
  globalThis.dispatchEvent(evt);
}

export default function ChargerOperationLogTable(
  { rows, isAdmin }: Props,
) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (rows.length === 0) {
    return (
      <div class="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No remote operations recorded for this charger yet.
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Charger operation log"
      tabIndex={0}
      class="rounded-lg border"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-8"></TableHead>
            <TableHead>When</TableHead>
            <TableHead>Operation</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>By</TableHead>
            <TableHead class="w-0"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.flatMap((row) => {
            const open = expanded.has(row.id);
            const failure = row.status === "failed" || row.status === "timeout";
            const body = [
              <TableRow key={`r-${row.id}`} class={cn(open && "bg-muted/40")}>
                <TableCell>
                  <button
                    type="button"
                    aria-label={open ? "Collapse row" : "Expand row"}
                    aria-expanded={open}
                    class="inline-flex items-center justify-center rounded p-1 hover:bg-muted"
                    onClick={() => toggle(row.id)}
                  >
                    {open
                      ? <ChevronDown class="size-4" />
                      : <ChevronRight class="size-4" />}
                  </button>
                </TableCell>
                <TableCell
                  class="whitespace-nowrap text-xs"
                  title={new Date(row.requestedAtIso).toLocaleString()}
                >
                  {formatRelative(row.requestedAtIso)}
                </TableCell>
                <TableCell class="font-mono text-xs">{row.operation}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>
                    {row.status}
                  </Badge>
                  {row.taskId !== null && (
                    <span class="ml-2 font-mono text-[11px] text-muted-foreground">
                      task {row.taskId}
                    </span>
                  )}
                </TableCell>
                <TableCell class="text-xs">
                  {row.requestedByEmail ?? "—"}
                </TableCell>
                <TableCell>
                  {failure && isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rerun(row.operation, row.params)}
                    >
                      <RefreshCw class="size-3.5" />
                      Re-run
                    </Button>
                  )}
                </TableCell>
              </TableRow>,
            ];
            if (open) {
              body.push(
                <TableRow key={`d-${row.id}`} class="bg-muted/20">
                  <TableCell colSpan={6}>
                    <div class="flex flex-col gap-3 py-1">
                      <div>
                        <div class="text-[11px] font-semibold uppercase text-muted-foreground">
                          Params
                        </div>
                        <pre class="mt-1 max-h-60 overflow-auto rounded bg-background p-2 font-mono text-[11px]">
                          {JSON.stringify(row.params ?? {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div class="text-[11px] font-semibold uppercase text-muted-foreground">
                          Result
                        </div>
                        <pre class="mt-1 max-h-60 overflow-auto rounded bg-background p-2 font-mono text-[11px]">
                          {row.result
                            ? JSON.stringify(row.result, null, 2)
                            : "(no result recorded)"}
                        </pre>
                      </div>
                      {row.completedAtIso && (
                        <div class="text-[11px] text-muted-foreground">
                          Completed{" "}
                          {new Date(row.completedAtIso).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>,
              );
            }
            return body;
          })}
        </TableBody>
      </Table>
    </div>
  );
}
