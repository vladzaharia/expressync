import { useSignal } from "@preact/signals";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Filter, Loader2 } from "lucide-preact";

interface Props {
  events: Array<{
    id: number;
    transactionId: number;
    ocppTagId: string;
    lagoEventId: string;
    kwhDelta: number;
    syncedAt: Date;
  }>;
}

export default function TransactionsTable({ events: initialEvents }: Props) {
  const events = useSignal(initialEvents);
  const startDate = useSignal("");
  const endDate = useSignal("");
  const loading = useSignal(false);

  const handleFilter = async () => {
    loading.value = true;
    try {
      const params = new URLSearchParams();
      if (startDate.value) params.set("start", startDate.value);
      if (endDate.value) params.set("end", endDate.value);

      const res = await fetch(`/api/billing-events?${params}`);
      if (res.ok) {
        events.value = await res.json();
      }
    } catch (_e) {
      alert("Failed to filter events");
    } finally {
      loading.value = false;
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate.value}
                onInput={(e) => (startDate.value = (e.target as HTMLInputElement).value)}
                className="w-auto"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate.value}
                onInput={(e) => (endDate.value = (e.target as HTMLInputElement).value)}
                className="w-auto"
              />
            </div>
            <Button onClick={handleFilter} disabled={loading.value}>
              {loading.value ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Filtering...
                </>
              ) : (
                <>
                  <Filter className="mr-2 size-4" />
                  Filter
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Transaction ID</TableHead>
            <TableHead>OCPP Tag</TableHead>
            <TableHead>kWh</TableHead>
            <TableHead>Lago Event ID</TableHead>
            <TableHead>Synced At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.value.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No billing events found
              </TableCell>
            </TableRow>
          ) : (
            events.value.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">{event.transactionId}</TableCell>
                <TableCell className="font-mono">{event.ocppTagId}</TableCell>
                <TableCell>{event.kwhDelta.toFixed(2)}</TableCell>
                <TableCell className="font-mono text-xs">{event.lagoEventId}</TableCell>
                <TableCell>{new Date(event.syncedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

