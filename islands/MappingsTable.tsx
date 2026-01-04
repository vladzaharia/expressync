import { useSignal } from "@preact/signals";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CornerDownRight, Loader2, Pencil, Trash2 } from "lucide-preact";

interface Props {
  mappings: Array<{
    id: number;
    steveOcppIdTag: string;
    steveOcppTagPk: number;
    lagoCustomerExternalId: string;
    lagoSubscriptionExternalId: string;
    displayName?: string;
    notes?: string;
    isActive: boolean;
    createdAt: Date;
  }>;
}

export default function MappingsTable({ mappings: initialMappings }: Props) {
  const mappings = useSignal(initialMappings);
  const deleting = useSignal<number | null>(null);

  const handleDelete = async (id: number) => {
    const mapping = mappings.value.find((m) => m.id === id);
    const confirmMsg = mapping?.notes?.includes("Auto-created from parent")
      ? "This mapping was auto-created from a parent tag. Are you sure you want to delete it?"
      : "Are you sure you want to delete this mapping? This will also delete all child tag mappings.";

    if (!confirm(confirmMsg)) return;

    deleting.value = id;
    try {
      const res = await fetch(`/api/mappings?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        if (data.deletedCount && data.deletedCount > 1) {
          alert(
            `Deleted ${data.deletedCount} mappings (1 parent + ${
              data.deletedCount - 1
            } children)`,
          );
        }
        window.location.reload();
      } else {
        alert("Failed to delete mapping");
      }
    } catch (_e) {
      alert("An error occurred");
    } finally {
      deleting.value = null;
    }
  };

  const handleToggleActive = async (id: number, isActive: boolean) => {
    try {
      const res = await fetch(`/api/mappings?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (res.ok) {
        window.location.reload();
      } else {
        alert("Failed to update mapping");
      }
    } catch (_e) {
      alert("An error occurred");
    }
  };

  if (mappings.value.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No mappings found. Create your first mapping to get started.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>OCPP Tag</TableHead>
          <TableHead>Display Name</TableHead>
          <TableHead>Lago Customer</TableHead>
          <TableHead>Subscription</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="max-w-[200px]">Notes</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mappings.value.map((mapping) => {
          const isChildMapping = mapping.notes?.includes(
            "Auto-created from parent",
          );
          return (
            <TableRow
              key={mapping.id}
              className={isChildMapping ? "bg-muted/30" : ""}
            >
              <TableCell className="font-mono">
                <div className="flex items-center gap-1">
                  {isChildMapping && (
                    <CornerDownRight className="size-3 text-muted-foreground" />
                  )}
                  {mapping.steveOcppIdTag}
                </div>
              </TableCell>
              <TableCell>{mapping.displayName || "-"}</TableCell>
              <TableCell className="font-mono text-xs">
                {mapping.lagoCustomerExternalId}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {mapping.lagoSubscriptionExternalId}
              </TableCell>
              <TableCell>
                <Badge
                  variant={mapping.isActive ? "success" : "secondary"}
                  className="cursor-pointer"
                  onClick={() =>
                    handleToggleActive(mapping.id, mapping.isActive)}
                >
                  {mapping.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell
                className="max-w-[200px] truncate text-muted-foreground"
                title={mapping.notes || ""}
              >
                {mapping.notes || "-"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" asChild>
                    <a href={`/mappings/${mapping.id}`}>
                      <Pencil className="size-4" />
                      <span className="sr-only">Edit</span>
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(mapping.id)}
                    disabled={deleting.value === mapping.id}
                    className="text-destructive hover:text-destructive"
                  >
                    {deleting.value === mapping.id
                      ? <Loader2 className="size-4 animate-spin" />
                      : <Trash2 className="size-4" />}
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
