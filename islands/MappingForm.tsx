import { useSignal, useComputed } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { Check, Tag, User, CreditCard, FileText, AlertTriangle, Loader2, Package } from "lucide-preact";

interface Props {
  mapping?: {
    id: number;
    steveOcppIdTag: string;
    steveOcppTagPk: number;
    lagoCustomerExternalId: string;
    lagoSubscriptionExternalId: string;
    displayName?: string;
    notes?: string;
    isActive: boolean;
  };
}

interface OcppTag {
  id: string;
  ocppTagPk: number;
  note: string;
  parentIdTag: string | null;
}

interface UserMapping {
  id: number;
  steveOcppIdTag: string;
  steveOcppTagPk: number;
  lagoCustomerExternalId: string;
  lagoSubscriptionExternalId: string;
  displayName?: string;
  notes?: string;
  isActive: boolean;
}

export default function MappingForm({ mapping }: Props) {
  const ocppTagId = useSignal(mapping?.steveOcppIdTag || "");
  const ocppTagPk = useSignal(mapping?.steveOcppTagPk || 0);
  const lagoCustomerId = useSignal(mapping?.lagoCustomerExternalId || "");
  const lagoSubscriptionId = useSignal(mapping?.lagoSubscriptionExternalId || "");
  const displayName = useSignal(mapping?.displayName || "");
  const notes = useSignal(mapping?.notes || "");
  const isActive = useSignal(mapping?.isActive ?? true);
  const loading = useSignal(false);
  const error = useSignal("");
  const successMessage = useSignal("");

  // Fetch options from APIs
  const ocppTags = useSignal<Array<OcppTag>>([]);
  const existingMappings = useSignal<Array<UserMapping>>([]);
  const lagoCustomers = useSignal<Array<{ id: string; name: string }>>([]);
  const lagoSubscriptions = useSignal<
    Array<{ id: string; name: string; customerId: string }>
  >([]);

  const filteredSubscriptions = useComputed(() => {
    if (!lagoCustomerId.value) return [];
    return lagoSubscriptions.value.filter(
      (sub) => sub.customerId === lagoCustomerId.value,
    );
  });

  const hasActiveSubscriptions = useComputed(() => {
    return filteredSubscriptions.value.length > 0;
  });

  // Helper function to get all child tags recursively
  const getAllChildTags = (parentId: string): OcppTag[] => {
    const children: OcppTag[] = [];
    const directChildren = ocppTags.value.filter(t => t.parentIdTag === parentId);

    for (const child of directChildren) {
      children.push(child);
      children.push(...getAllChildTags(child.id));
    }

    return children;
  };

  // Helper function to check if a tag has a mapped parent
  const hasMappedParent = (tag: OcppTag): string | null => {
    if (!tag.parentIdTag) return null;

    const parentMapping = existingMappings.value.find(
      m => m.steveOcppIdTag === tag.parentIdTag
    );

    if (parentMapping) {
      return tag.parentIdTag;
    }

    // Check grandparents recursively
    const parent = ocppTags.value.find(t => t.id === tag.parentIdTag);
    if (parent) {
      return hasMappedParent(parent);
    }

    return null;
  };

  // Filter tags to show only unmapped tags (or tags with mapped parents for override)
  const availableTags = useComputed(() => {
    return ocppTags.value.filter(tag => {
      // If editing, allow the current tag
      if (mapping && tag.id === mapping.steveOcppIdTag) {
        return true;
      }

      // Check if tag already has a direct mapping
      const hasDirectMapping = existingMappings.value.some(
        m => m.steveOcppIdTag === tag.id
      );

      if (hasDirectMapping) {
        return false; // Hide tags with direct mappings
      }

      // Tag is available if it has no mapping
      return true;
    });
  });

  // Compute info for each available tag
  const tagInfoMap = useComputed(() => {
    const map = new Map<string, {
      tag: OcppTag;
      childCount: number;
      mappedParent: string | null;
    }>();

    for (const tag of availableTags.value) {
      const children = getAllChildTags(tag.id);
      const mappedParent = hasMappedParent(tag);

      map.set(tag.id, {
        tag,
        childCount: children.length,
        mappedParent,
      });
    }

    return map;
  });

  useEffect(() => {
    // Fetch OCPP tags
    fetch("/api/steve/ocpp-tags")
      .then((res) => res.json())
      .then((data) => (ocppTags.value = data))
      .catch(console.error);

    // Fetch existing mappings
    fetch("/api/mappings")
      .then((res) => res.json())
      .then((data) => (existingMappings.value = data))
      .catch(console.error);

    // Fetch Lago customers
    fetch("/api/lago/customers")
      .then((res) => res.json())
      .then((data) => (lagoCustomers.value = data))
      .catch(console.error);

    // Fetch Lago subscriptions
    fetch("/api/lago/subscriptions")
      .then((res) => res.json())
      .then((data) => (lagoSubscriptions.value = data))
      .catch(console.error);
  }, []);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    // Validate required fields
    if (!ocppTagId.value) {
      error.value = "Please select an OCPP tag";
      return;
    }
    if (!lagoCustomerId.value) {
      error.value = "Please select a Lago customer";
      return;
    }
    // Subscription is now optional - will be auto-selected at sync time if not specified

    loading.value = true;
    error.value = "";
    successMessage.value = "";

    try {
      const url = mapping ? `/api/mappings?id=${mapping.id}` : "/api/mappings";
      const method = mapping ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocppTagId: ocppTagId.value,
          ocppTagPk: ocppTagPk.value,
          lagoCustomerId: lagoCustomerId.value,
          lagoSubscriptionId: lagoSubscriptionId.value,
          displayName: displayName.value || null,
          notes: notes.value || null,
          isActive: isActive.value,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.totalCreated && data.totalCreated > 1) {
          successMessage.value = `Successfully created ${data.totalCreated} mappings (1 parent + ${data.totalCreated - 1} children)`;
          setTimeout(() => {
            window.location.href = "/mappings";
          }, 2000);
        } else {
          window.location.href = "/mappings";
        }
      } else {
        const data = await res.json();
        error.value = data.error || "Failed to save mapping";
      }
    } catch (_e) {
      error.value = "An error occurred. Please try again.";
    } finally {
      loading.value = false;
    }
  };

  // Compute progress
  const currentStep = useComputed(() => {
    if (!ocppTagId.value) return 1;
    if (!lagoCustomerId.value) return 2;
    // Subscription is optional, so we move to step 3 once customer is selected
    if (lagoCustomerId.value && !lagoSubscriptionId.value && hasActiveSubscriptions.value) return 3;
    return 4;
  });

  const StepIndicator = ({ step, label, icon: Icon }: { step: number; label: string; icon: typeof Tag }) => (
    <div className="flex items-center gap-2">
      <div className={cn(
        "flex items-center justify-center size-8 rounded-full transition-colors",
        currentStep.value >= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      )}>
        {currentStep.value > step ? <Check className="size-4" /> : <Icon className="size-4" />}
      </div>
      <span className={cn(
        "text-sm font-medium hidden sm:inline",
        currentStep.value >= step ? "text-foreground" : "text-muted-foreground"
      )}>{label}</span>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-between mb-8">
        <StepIndicator step={1} label="Tag" icon={Tag} />
        <div className={cn("flex-1 h-0.5 mx-2 transition-colors", currentStep.value >= 2 ? "bg-primary" : "bg-muted")} />
        <StepIndicator step={2} label="Customer" icon={User} />
        <div className={cn("flex-1 h-0.5 mx-2 transition-colors", currentStep.value >= 3 ? "bg-primary" : "bg-muted")} />
        <StepIndicator step={3} label="Subscription" icon={CreditCard} />
        <div className={cn("flex-1 h-0.5 mx-2 transition-colors", currentStep.value >= 4 ? "bg-primary" : "bg-muted")} />
        <StepIndicator step={4} label="Details" icon={FileText} />
      </div>

      {error.value && (
        <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm border border-destructive/20">
          {error.value}
        </div>
      )}

      {successMessage.value && (
        <div className="bg-green-500/10 text-green-600 p-3 rounded-md text-sm border border-green-500/20">
          {successMessage.value}
        </div>
      )}

      <div className="space-y-2">
        <Label>Select OCPP Tag</Label>

        {availableTags.value.length === 0 ? (
          <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground">
            No available tags to map. All tags have been mapped.
          </div>
        ) : ocppTagId.value ? (
          <div className="border border-primary bg-primary/5 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <Tag className="size-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold font-mono">{ocppTagId.value}</h3>
                  {(() => {
                    const selectedTag = availableTags.value.find(t => t.id === ocppTagId.value);
                    return selectedTag?.note && (
                      <p className="text-sm text-muted-foreground mt-1">{selectedTag.note}</p>
                    );
                  })()}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  ocppTagId.value = "";
                  ocppTagPk.value = 0;
                }}
              >
                Change
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1">
            {availableTags.value.map((tag) => {
              const info = tagInfoMap.value.get(tag.id);
              return (
                <div
                  key={tag.id}
                  onClick={() => {
                    ocppTagId.value = tag.id;
                    ocppTagPk.value = tag.ocppTagPk;
                  }}
                  className="border border-border hover:border-primary/50 hover:bg-accent rounded-lg p-3 cursor-pointer transition-all"
                >
                  <div className="flex items-start gap-2">
                    <Tag className="size-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium font-mono text-sm truncate">{tag.id}</h3>
                      {tag.note && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{tag.note}</p>
                      )}
                    </div>
                  </div>
                  {info && info.childCount > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-primary font-medium flex items-center gap-1">
                        <Package className="size-3" />
                        {info.childCount} child{info.childCount > 1 ? "ren" : ""}
                      </p>
                    </div>
                  )}
                  {info && info.mappedParent && (
                    <div className="mt-2 pt-2 border-t border-yellow-500/30 bg-yellow-500/10 -mx-3 -mb-3 px-3 py-2 rounded-b-lg">
                      <p className="text-xs text-yellow-600 font-medium flex items-center gap-1">
                        <AlertTriangle className="size-3" />
                        Parent mapped - will override
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Select Lago Customer</Label>

        {lagoCustomers.value.length === 0 ? (
          <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Loading customers...
          </div>
        ) : lagoCustomerId.value ? (
          <div className="border border-primary bg-primary/5 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <User className="size-5 text-primary mt-0.5" />
                <div className="flex-1">
                  {(() => {
                    const selectedCustomer = lagoCustomers.value.find(c => c.id === lagoCustomerId.value);
                    return selectedCustomer && (
                      <h3 className="font-semibold">{selectedCustomer.name}</h3>
                    );
                  })()}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  lagoCustomerId.value = "";
                  lagoSubscriptionId.value = "";
                }}
              >
                Change
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1">
            {lagoCustomers.value.map((customer) => (
              <div
                key={customer.id}
                onClick={() => {
                  lagoCustomerId.value = customer.id;
                  lagoSubscriptionId.value = "";
                }}
                className="border border-border hover:border-primary/50 hover:bg-accent rounded-lg p-3 cursor-pointer transition-all"
              >
                <div className="flex items-start gap-2">
                  <User className="size-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{customer.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{customer.id}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Select Lago Subscription <span className="text-muted-foreground text-xs">(Optional)</span></Label>

        {!lagoCustomerId.value ? (
          <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground">
            Please select a customer first
          </div>
        ) : filteredSubscriptions.value.length === 0 ? (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-yellow-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-yellow-600 mb-1">No Active Subscriptions</h4>
                <p className="text-sm text-yellow-600/80 mb-2">
                  This customer has no active subscriptions. You can still save this mapping, but:
                </p>
                <ul className="text-sm text-yellow-600/80 list-disc list-inside space-y-1">
                  <li>Transactions will be saved but not sent to Lago</li>
                  <li>The first active subscription will be auto-selected when syncing</li>
                </ul>
              </div>
            </div>
          </div>
        ) : lagoSubscriptionId.value ? (
          <div className="border border-primary bg-primary/5 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <CreditCard className="size-5 text-primary mt-0.5" />
                <div className="flex-1">
                  {(() => {
                    const selectedSub = filteredSubscriptions.value.find(s => s.id === lagoSubscriptionId.value);
                    return selectedSub && (
                      <>
                        <h3 className="font-semibold">{selectedSub.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1 font-mono">{selectedSub.id}</p>
                      </>
                    );
                  })()}
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => { lagoSubscriptionId.value = ""; }}>
                Change
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1">
            {filteredSubscriptions.value.map((sub) => (
              <div
                key={sub.id}
                onClick={() => { lagoSubscriptionId.value = sub.id; }}
                className="border border-border hover:border-primary/50 hover:bg-accent rounded-lg p-3 cursor-pointer transition-all"
              >
                <div className="flex items-start gap-2">
                  <CreditCard className="size-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{sub.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{sub.id}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="displayName">Display Name <span className="text-muted-foreground text-xs">(Optional)</span></Label>
        <Input
          id="displayName"
          type="text"
          value={displayName.value}
          onInput={(e) => (displayName.value = (e.target as HTMLInputElement).value)}
          placeholder="Friendly name for this mapping"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes <span className="text-muted-foreground text-xs">(Optional)</span></Label>
        <Textarea
          id="notes"
          value={notes.value}
          onInput={(e) => (notes.value = (e.target as HTMLTextAreaElement).value)}
          rows={3}
          placeholder="Additional notes about this mapping"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="isActive"
          checked={isActive.value}
          onCheckedChange={(checked) => (isActive.value = checked)}
        />
        <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={loading.value}>
          {loading.value ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving...
            </>
          ) : (
            mapping ? "Update Mapping" : "Create Mapping"
          )}
        </Button>
        <Button variant="outline" asChild>
          <a href="/mappings">Cancel</a>
        </Button>
      </div>
    </form>
  );
}

