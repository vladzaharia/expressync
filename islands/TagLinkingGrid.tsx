import { useSignal } from "@preact/signals";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
} from "@/components/ui/card.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  ArrowRight,
  CornerDownRight,
  CreditCard,
  Pencil,
  Tag,
  Trash2,
  User,
} from "lucide-preact";

interface MappingGroup {
  customerId: string;
  customerName: string;
  customerEmail?: string;
  subscriptionId: string;
  subscriptionName?: string;
  isActive: boolean;
  tags: Array<{
    id: string;
    ocppTagPk: number;
    mappingId: number;
    isChild: boolean;
  }>;
}

interface Props {
  groups: MappingGroup[];
  lagoDashboardUrl?: string;
  steveDashboardUrl?: string;
}

export default function TagLinkingGrid({
  groups: initialGroups,
  lagoDashboardUrl,
  steveDashboardUrl,
}: Props) {
  const groups = useSignal(initialGroups);
  const deleting = useSignal<number | null>(null);

  // Build URLs for external links
  const getCustomerUrl = (customerId: string) =>
    lagoDashboardUrl ? `${lagoDashboardUrl}/customers/${customerId}` : null;

  const getOcppTagUrl = (ocppTagPk: number) =>
    steveDashboardUrl ? `${steveDashboardUrl}/manager/ocppTags/details/${ocppTagPk}` : null;

  const handleDelete = async (mappingId: number) => {
    const group = groups.value.find((g) =>
      g.tags.some((t) => t.mappingId === mappingId)
    );
    const tagCount = group?.tags.length || 1;

    const confirmMsg = tagCount > 1
      ? `This will delete ${tagCount} tag links (1 parent + ${tagCount - 1} children). Are you sure?`
      : "Are you sure you want to delete this tag mapping?";

    if (!confirm(confirmMsg)) return;

    deleting.value = mappingId;
    try {
      const res = await fetch(`/api/links?id=${mappingId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.deletedCount && data.deletedCount > 1) {
          alert(
            `Deleted ${data.deletedCount} mappings (1 parent + ${data.deletedCount - 1} children)`,
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

  const handleToggleActive = async (mappingId: number, isActive: boolean) => {
    try {
      const res = await fetch(`/api/links?id=${mappingId}`, {
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

  if (groups.value.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="mb-4">No tag links found.</p>
        <p className="text-sm">
          Create your first tag link to start billing for EV charging sessions.
        </p>
      </div>
    );
  }

  return (
      <div className="space-y-4">
        {groups.value.map((group) => {
          const parentTags = group.tags.filter((t) => !t.isChild);
          const childTags = group.tags.filter((t) => t.isChild);
          const primaryMappingId = parentTags[0]?.mappingId;

          return (
            <div
              key={`${group.customerId}:${group.subscriptionId}`}
              className={cn(
                "flex items-center gap-4 p-4 rounded-lg border bg-card",
                !group.isActive && "opacity-60",
              )}
            >
              {/* User/Subscription Card */}
              {(() => {
                const customerUrl = getCustomerUrl(group.customerId);
                const hasSubscription = !!group.subscriptionId;
                const Icon = hasSubscription ? CreditCard : User;

                // Determine display name: full name > email > lago ID
                const displayName = group.customerName || group.customerEmail || group.customerId;

                // Build subtext based on what we have
                let subtext = "";
                if (hasSubscription) {
                  if (group.subscriptionName) {
                    subtext = group.subscriptionName;
                  } else {
                    subtext = group.subscriptionId;
                  }
                }

                const cardContent = (
                  <CardContent className="px-4 py-3 h-full flex flex-col justify-center">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                        <Icon className="size-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate text-sm">{displayName}</p>
                        {subtext && (
                          <p className="text-xs text-muted-foreground truncate">
                            {subtext}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                );
                return customerUrl ? (
                  <a href={customerUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 self-stretch">
                    <Card className="min-w-56 h-full hover:bg-accent/50 hover:border-primary/30 transition-colors cursor-pointer">
                      {cardContent}
                    </Card>
                  </a>
                ) : (
                  <Card className="min-w-56 shrink-0 self-stretch">
                    {cardContent}
                  </Card>
                );
              })()}

              {/* Arrow */}
              <div className="flex items-center text-muted-foreground shrink-0">
                <ArrowRight className="size-5" />
              </div>

              {/* OCPP Tags */}
              <div className="flex-1 flex flex-wrap items-stretch gap-2 min-w-0">
                {parentTags.map((tag) => {
                  const tagUrl = getOcppTagUrl(tag.ocppTagPk);
                  const cardContent = (
                    <CardContent className="px-4 py-3 h-full flex items-center gap-2">
                      <Tag className="size-4 text-primary" />
                      <span className="font-mono text-sm font-medium">{tag.id}</span>
                    </CardContent>
                  );
                  return tagUrl ? (
                    <a key={tag.id} href={tagUrl} target="_blank" rel="noopener noreferrer">
                      <Card className="shrink-0 min-w-44 h-full hover:bg-accent/50 hover:border-primary/30 transition-colors cursor-pointer">
                        {cardContent}
                      </Card>
                    </a>
                  ) : (
                    <Card key={tag.id} className="shrink-0 min-w-44">
                      {cardContent}
                    </Card>
                  );
                })}
                {childTags.map((tag) => {
                  const tagUrl = getOcppTagUrl(tag.ocppTagPk);
                  const cardContent = (
                    <CardContent className="px-4 py-3 h-full flex items-center gap-2">
                      <CornerDownRight className="size-4 text-muted-foreground" />
                      <span className="font-mono text-sm">{tag.id}</span>
                    </CardContent>
                  );
                  return tagUrl ? (
                    <a key={tag.id} href={tagUrl} target="_blank" rel="noopener noreferrer">
                      <Card className="shrink-0 min-w-44 bg-muted/30 h-full hover:bg-accent/50 hover:border-primary/30 transition-colors cursor-pointer">
                        {cardContent}
                      </Card>
                    </a>
                  ) : (
                    <Card key={tag.id} className="shrink-0 min-w-44 bg-muted/30">
                      {cardContent}
                    </Card>
                  );
                })}
              </div>

              {/* Status & Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant={group.isActive ? "success" : "secondary"}
                  className="cursor-pointer"
                  onClick={() => primaryMappingId && handleToggleActive(primaryMappingId, group.isActive)}
                >
                  {group.isActive ? "Active" : "Inactive"}
                </Badge>
                <Button variant="ghost" size="icon" asChild>
                  <a href={`/tag-linking/${primaryMappingId}`}>
                    <Pencil className="size-4" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => primaryMappingId && handleDelete(primaryMappingId)}
                  disabled={deleting.value === primaryMappingId}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
  );
}

