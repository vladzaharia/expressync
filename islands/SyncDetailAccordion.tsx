import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion.tsx";
import { Badge } from "../components/ui/badge.tsx";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Link2,
  MinusCircle,
  Receipt,
} from "lucide-preact";
import type { SyncRun, SyncRunLog } from "../src/db/schema.ts";

interface SyncDetailAccordionProps {
  run: SyncRun;
  tagLinkingLogs: SyncRunLog[];
  transactionSyncLogs: SyncRunLog[];
}

function SegmentStatusBadge({
  status,
  runCompleted,
}: {
  status: string | null;
  runCompleted: boolean;
}) {
  if (!status) {
    // If run is completed but no status recorded, show "Unknown" instead of "Pending"
    if (runCompleted) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <MinusCircle className="size-3 mr-1" />
          Unknown
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <MinusCircle className="size-3 mr-1" />
        Pending
      </Badge>
    );
  }

  const variants: Record<
    string,
    {
      variant: "success" | "warning" | "destructive" | "secondary" | "outline";
      icon: typeof CheckCircle2;
    }
  > = {
    success: { variant: "success", icon: CheckCircle2 },
    warning: { variant: "warning", icon: AlertTriangle },
    error: { variant: "destructive", icon: AlertCircle },
    skipped: { variant: "secondary", icon: MinusCircle },
  };

  const config = variants[status] ||
    { variant: "outline" as const, icon: Info };
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="size-3" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function LogLevelIcon({ level }: { level: string }) {
  switch (level) {
    case "error":
      return <AlertCircle className="size-4 text-destructive" />;
    case "warn":
      return <AlertTriangle className="size-4 text-yellow-500" />;
    case "info":
      return <Info className="size-4 text-blue-500" />;
    default:
      return <Info className="size-4 text-muted-foreground" />;
  }
}

function SegmentCard({
  title,
  icon: Icon,
  status,
  logs,
  runCompleted,
}: {
  title: string;
  icon: typeof Link2;
  status: string | null;
  logs: SyncRunLog[];
  runCompleted: boolean;
}) {
  return (
    <AccordionItem value={title.toLowerCase().replace(" ", "_")}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted">
            <Icon className="size-4" />
          </div>
          <span className="font-medium">{title}</span>
          <SegmentStatusBadge status={status} runCompleted={runCompleted} />
          <span className="text-sm text-muted-foreground ml-auto mr-4">
            {logs.length} log{logs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {logs.length === 0
          ? (
            <p className="text-sm text-muted-foreground py-4">
              No logs recorded for this segment.
            </p>
          )
          : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-2 rounded-md bg-muted/50 text-sm"
                >
                  <LogLevelIcon level={log.level} />
                  <div className="flex-1 min-w-0">
                    <p className="break-words">{log.message}</p>
                    {log.context && (
                      <pre className="mt-1 text-xs text-muted-foreground overflow-x-auto">
                      {JSON.stringify(JSON.parse(log.context), null, 2)}
                      </pre>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
      </AccordionContent>
    </AccordionItem>
  );
}

export default function SyncDetailAccordion(
  { run, tagLinkingLogs, transactionSyncLogs }: SyncDetailAccordionProps,
) {
  const isCompleted = run.status === "completed" || run.status === "failed";

  return (
    <Accordion type="single" className="space-y-2">
      <SegmentCard
        title="Tag Linking"
        icon={Link2}
        status={run.tagLinkingStatus}
        logs={tagLinkingLogs}
        runCompleted={isCompleted}
      />
      <SegmentCard
        title="Transaction Sync"
        icon={Receipt}
        status={run.transactionSyncStatus}
        logs={transactionSyncLogs}
        runCompleted={isCompleted}
      />
    </Accordion>
  );
}
