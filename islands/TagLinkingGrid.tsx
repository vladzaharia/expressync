import { useSignal } from "@preact/signals";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  ArrowDown,
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
  customerLagoId?: string;
  subscriptionId: string;
  subscriptionName?: string;
  subscriptionLagoId?: string;
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

  // Build URLs for external links using Lago internal IDs
  // Lago URL format: /customer/{lagoCustomerId} and /customer/{lagoCustomerId}/subscription/{lagoSubscriptionId}/overview
  const getCustomerUrl = (lagoCustomerId?: string) =>
    lagoDashboardUrl && lagoCustomerId
      ? `${lagoDashboardUrl}/customer/${lagoCustomerId}`
      : null;

  const getSubscriptionUrl = (lagoCustomerId?: string, lagoSubscriptionId?: string) =>
    lagoDashboardUrl && lagoCustomerId && lagoSubscriptionId
      ? `${lagoDashboardUrl}/customer/${lagoCustomerId}/subscription/${lagoSubscriptionId}/overview`
      : null;

  const getOcppTagUrl = (ocppTagPk: number) =>
    steveDashboardUrl
      ? `${steveDashboardUrl}/manager/ocppTags/details/${ocppTagPk}`
      : null;

  const handleDelete = async (mappingId: number) => {
    const group = groups.value.find((g) =>
      g.tags.some((t) => t.mappingId === mappingId)
    );
    const tagCount = group?.tags.length || 1;

    const confirmMsg = tagCount > 1
      ? `This will delete ${tagCount} tag links (1 parent + ${
        tagCount - 1
      } children). Are you sure?`
      : "Are you sure you want to delete this tag mapping?";

    if (!confirm(confirmMsg)) return;

    deleting.value = mappingId;
    try {
      const res = await fetch(`/api/tag/link?id=${mappingId}`, {
        method: "DELETE",
      });
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

  const handleToggleActive = async (mappingId: number, isActive: boolean) => {
    try {
      const res = await fetch(`/api/tag/link?id=${mappingId}`, {
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

  // Shared card height for consistency
  const cardHeightClass = "min-h-[52px]";

  return (
    <div className="space-y-4">
      {groups.value.map((group) => {
        const parentTags = group.tags.filter((t) => !t.isChild);
        const childTags = group.tags.filter((t) => t.isChild);
        const primaryMappingId = parentTags[0]?.mappingId;

        // Extract customer/subscription card logic
        const hasSubscription = !!group.subscriptionId;
        const linkUrl = hasSubscription
          ? getSubscriptionUrl(group.customerLagoId, group.subscriptionLagoId)
          : getCustomerUrl(group.customerLagoId);
        const Icon = hasSubscription ? CreditCard : User;
        const displayName = group.customerName || group.customerEmail ||
          group.customerId;
        let subtext = "";
        if (hasSubscription) {
          subtext = group.subscriptionName || group.subscriptionId;
        }

        // Customer/Subscription card content - smaller vertical, larger horizontal padding
        const customerCardContent = (
          <CardContent className={cn("px-5 py-1.5 h-full flex flex-col justify-center", cardHeightClass)}>
            <div className="flex items-center gap-4">
              <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 shrink-0">
                <Icon className="size-4 text-violet-500" />
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

        // OCPP Tag card component
        const renderTagCard = (
          tag: { id: string; ocppTagPk: number; isChild: boolean },
        ) => {
          const tagUrl = getOcppTagUrl(tag.ocppTagPk);
          const tagCardContent = (
            <CardContent className={cn("px-5 py-1.5 h-full flex items-center gap-4", cardHeightClass)}>
              {tag.isChild
                ? <CornerDownRight className="size-4 text-muted-foreground" />
                : <Tag className="size-4 text-violet-500" />}
              <span className={cn("font-mono text-sm", !tag.isChild && "font-medium")}>
                {tag.id}
              </span>
            </CardContent>
          );

          const cardClasses = cn(
            "shrink-0 h-full border-2 transition-colors",
            tag.isChild && "bg-muted/30",
            tagUrl && "hover:border-violet-500/70 cursor-pointer",
          );

          return tagUrl
            ? (
              <a
                key={tag.id}
                href={tagUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-[calc(50%-0.25rem)] md:w-auto md:min-w-44"
              >
                <Card className={cardClasses}>{tagCardContent}</Card>
              </a>
            )
            : (
              <Card key={tag.id} className={cn(cardClasses, "w-[calc(50%-0.25rem)] md:w-auto md:min-w-44")}>
                {tagCardContent}
              </Card>
            );
        };

        return (
          <div
            key={`${group.customerId}:${group.subscriptionId}`}
            className={cn(
              "flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-lg border bg-card",
              !group.isActive && "opacity-60",
            )}
          >
            {/* Customer/Subscription Card */}
            {linkUrl
              ? (
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 self-stretch"
                >
                  <Card className="min-w-56 h-full border-2 hover:border-violet-500/70 transition-colors cursor-pointer">
                    {customerCardContent}
                  </Card>
                </a>
              )
              : (
                <Card className="min-w-56 shrink-0 self-stretch">
                  {customerCardContent}
                </Card>
              )}

            {/* Arrow - horizontal on desktop, vertical on mobile */}
            <div className="hidden md:flex items-center text-muted-foreground shrink-0">
              <ArrowRight className="size-5" />
            </div>
            <div className="flex md:hidden items-center justify-center text-muted-foreground">
              <ArrowDown className="size-5" />
            </div>

            {/* OCPP Tags - wrap to multiple lines as needed */}
            <div className="flex-1 flex flex-wrap items-stretch content-start gap-2 min-w-0 overflow-hidden">
              {parentTags.map((tag) => renderTagCard({ ...tag, isChild: false }))}
              {childTags.map((tag) => renderTagCard({ ...tag, isChild: true }))}
            </div>

            {/* Status & Actions */}
            <div className="flex items-center justify-between gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border w-full md:w-auto md:ml-auto">
              {/* Status badge - left on mobile */}
              <Badge
                variant={group.isActive ? "success" : "secondary"}
                className="cursor-pointer"
                onClick={() =>
                  primaryMappingId &&
                  handleToggleActive(primaryMappingId, group.isActive)}
              >
                {group.isActive ? "Active" : "Inactive"}
              </Badge>
              {/* Action buttons - right on mobile, icon-only on desktop */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild className="gap-2 md:gap-0">
                  <a href={`/links/${primaryMappingId}`}>
                    <Pencil className="size-4" />
                    <span className="md:hidden">Edit</span>
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 md:gap-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    primaryMappingId && handleDelete(primaryMappingId)}
                  disabled={deleting.value === primaryMappingId}
                >
                  <Trash2 className="size-4" />
                  <span className="md:hidden">{deleting.value === primaryMappingId ? "Deleting..." : "Delete"}</span>
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
