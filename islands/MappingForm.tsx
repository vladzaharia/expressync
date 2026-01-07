import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  AlertTriangle,
  Check,
  CreditCard,
  Loader2,
  Package,
  Plus,
  Radio,
  Tag,
  User,
  X,
} from "lucide-preact";
import TapToAddModal from "./TapToAddModal.tsx";

interface Props {
  mapping?: {
    id: number;
    steveOcppIdTag: string;
    steveOcppTagPk: number;
    lagoCustomerExternalId: string;
    lagoSubscriptionExternalId: string;
    isActive: boolean;
  };
}

interface OcppTag {
  id: string;
  ocppTagPk: number;
  parentIdTag: string | null;
}

interface UserMapping {
  id: number;
  steveOcppIdTag: string;
  steveOcppTagPk: number;
  lagoCustomerExternalId: string;
  lagoSubscriptionExternalId: string;
  isActive: boolean;
}

export default function MappingForm({ mapping }: Props) {
  const ocppTagId = useSignal(mapping?.steveOcppIdTag || "");
  const ocppTagPk = useSignal(mapping?.steveOcppTagPk || 0);
  const lagoCustomerId = useSignal(mapping?.lagoCustomerExternalId || "");
  const lagoSubscriptionId = useSignal(
    mapping?.lagoSubscriptionExternalId || "",
  );
  const isActive = useSignal(mapping?.isActive ?? true);
  const loading = useSignal(false);
  const error = useSignal("");
  const successMessage = useSignal("");

  // State for creating new OCPP tag
  const showCreateTag = useSignal(false);
  const newTagId = useSignal("");
  const newTagParent = useSignal("");
  const creatingTag = useSignal(false);

  // State for tap-to-add modal
  const showTapToAdd = useSignal(false);

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
    const directChildren = ocppTags.value.filter((t) =>
      t.parentIdTag === parentId
    );

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
      (m) => m.steveOcppIdTag === tag.parentIdTag,
    );

    if (parentMapping) {
      return tag.parentIdTag;
    }

    // Check grandparents recursively
    const parent = ocppTags.value.find((t) => t.id === tag.parentIdTag);
    if (parent) {
      return hasMappedParent(parent);
    }

    return null;
  };

  // Filter tags to show only unmapped tags (or tags with mapped parents for override)
  const availableTags = useComputed(() => {
    return ocppTags.value.filter((tag) => {
      // If editing, allow the current tag
      if (mapping && tag.id === mapping.steveOcppIdTag) {
        return true;
      }

      // Check if tag already has a direct mapping
      const hasDirectMapping = existingMappings.value.some(
        (m) => m.steveOcppIdTag === tag.id,
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
    fetch("/api/tag")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          ocppTags.value = data;
        }
      })
      .catch(console.error);

    // Fetch existing mappings
    fetch("/api/tag/link")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          existingMappings.value = data;
        }
      })
      .catch(console.error);

    // Fetch customers
    fetch("/api/customer")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          lagoCustomers.value = data;
        }
      })
      .catch(console.error);

    // Fetch subscriptions
    fetch("/api/subscription")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          lagoSubscriptions.value = data;
        }
      })
      .catch(console.error);
  }, []);

  const handleCreateTag = async () => {
    if (!newTagId.value.trim()) {
      error.value = "Please enter a tag ID";
      return;
    }

    creatingTag.value = true;
    error.value = "";

    try {
      const res = await fetch("/api/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idTag: newTagId.value.trim(),
          parentIdTag: newTagParent.value || undefined,
        }),
      });

      if (res.ok) {
        const newTag = await res.json();
        // Add to tags list and select it
        ocppTags.value = [...ocppTags.value, newTag];
        ocppTagId.value = newTag.id;
        ocppTagPk.value = newTag.ocppTagPk;
        // Reset create form
        showCreateTag.value = false;
        newTagId.value = "";
        newTagParent.value = "";
        successMessage.value = `Tag "${newTag.id}" created successfully`;
      } else {
        const data = await res.json();
        error.value = data.error || "Failed to create tag";
      }
    } catch (_e) {
      error.value = "An error occurred while creating the tag";
    } finally {
      creatingTag.value = false;
    }
  };

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
      const url = mapping ? `/api/tag/link?id=${mapping.id}` : "/api/tag/link";
      const method = mapping ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ocppTagId: ocppTagId.value,
          ocppTagPk: ocppTagPk.value,
          lagoCustomerId: lagoCustomerId.value,
          lagoSubscriptionId: lagoSubscriptionId.value,
          isActive: isActive.value,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.totalCreated && data.totalCreated > 1) {
          successMessage.value =
            `Successfully created ${data.totalCreated} mappings (1 parent + ${
              data.totalCreated - 1
            } children)`;
          setTimeout(() => {
            window.location.href = "/links";
          }, 2000);
        } else {
          window.location.href = "/links";
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

  // Compute progress - 3 steps: Tag, Customer, Subscription
  const currentStep = useComputed(() => {
    if (!ocppTagId.value) return 1;
    if (!lagoCustomerId.value) return 2;
    return 3;
  });

  const StepIndicator = (
    { step, label, icon: Icon }: {
      step: number;
      label: string;
      icon: typeof Tag;
    },
  ) => (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex items-center justify-center size-8 rounded-full transition-colors",
          currentStep.value >= step
            ? "bg-violet-500 text-white"
            : "bg-muted text-muted-foreground",
        )}
      >
        {currentStep.value > step
          ? <Check className="size-4" />
          : <Icon className="size-4" />}
      </div>
      <span
        className={cn(
          "text-sm font-medium hidden sm:inline",
          currentStep.value >= step
            ? "text-foreground"
            : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-between mb-8">
        <StepIndicator step={1} label="Tag" icon={Tag} />
        <div
          className={cn(
            "flex-1 h-0.5 mx-2 transition-colors",
            currentStep.value >= 2 ? "bg-violet-500" : "bg-muted",
          )}
        />
        <StepIndicator step={2} label="Customer" icon={User} />
        <div
          className={cn(
            "flex-1 h-0.5 mx-2 transition-colors",
            currentStep.value >= 3 ? "bg-violet-500" : "bg-muted",
          )}
        />
        <StepIndicator step={3} label="Subscription" icon={CreditCard} />
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
        <div className="flex items-center justify-between">
          <Label>Select OCPP Tag</Label>
          {!mapping && !ocppTagId.value && !showCreateTag.value && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                showCreateTag.value = true;
              }}
              className="border-purple-500 text-purple-600 hover:bg-purple-500/10 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-400"
            >
              <Plus className="size-4 mr-1" />
              Create New Tag
            </Button>
          )}
        </div>

        {/* Create new tag form */}
        {showCreateTag.value && (
          <div className="border border-dashed border-violet-500 rounded-lg p-4 space-y-4 bg-violet-500/5">
            <div className="flex items-center justify-between">
              <h4 className="font-medium flex items-center gap-2">
                <Plus className="size-4" />
                Create New OCPP Tag
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  showCreateTag.value = false;
                  newTagId.value = "";
                  newTagParent.value = "";
                }}
                className="text-red-600 hover:text-red-600 hover:bg-red-500/10 dark:text-red-400 dark:hover:text-red-400"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <div>
                <Label htmlFor="newTagId" className="text-sm">Tag ID *</Label>
                <div className="flex gap-2">
                  <Input
                    id="newTagId"
                    value={newTagId.value}
                    onInput={(
                      e,
                    ) => (newTagId.value = (e.target as HTMLInputElement).value)}
                    placeholder="e.g., CARD-001"
                    className="font-mono flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      showTapToAdd.value = true;
                    }}
                    className="border-purple-500 text-purple-600 hover:bg-purple-500/10 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-400"
                  >
                    <Radio className="size-4 mr-1" />
                    Tap to Add
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  1-20 alphanumeric characters (including _ and -)
                </p>
              </div>
              <div>
                <Label htmlFor="newTagParent" className="text-sm">
                  Parent Tag (optional)
                </Label>
                <select
                  id="newTagParent"
                  value={newTagParent.value}
                  onChange={(
                    e,
                  ) => (newTagParent.value =
                    (e.target as HTMLSelectElement).value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">No parent</option>
                  {ocppTags.value.map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.id}</option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                onClick={handleCreateTag}
                disabled={creatingTag.value}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              >
                {creatingTag.value
                  ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  )
                  : (
                    <>
                      <Plus className="size-4 mr-2" />
                      Create Tag
                    </>
                  )}
              </Button>
            </div>
          </div>
        )}

        {/* Existing tag selection */}
        {!showCreateTag.value && (
          availableTags.value.length === 0
            ? (
              <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground">
                No available tags to map. All tags have been mapped.
              </div>
            )
            : ocppTagId.value
            ? (
              <div className="border-2 border-violet-500 bg-violet-500/5 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <Tag className="size-5 text-violet-500 shrink-0" />
                    <h3 className="font-semibold font-mono truncate">
                      {ocppTagId.value}
                    </h3>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      ocppTagId.value = "";
                      ocppTagPk.value = 0;
                    }}
                    className="text-purple-600 hover:text-purple-600 hover:bg-purple-500/10 dark:text-purple-400 dark:hover:text-purple-400"
                  >
                    Change
                  </Button>
                </div>
              </div>
            )
            : (
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
                      className="border-2 border-border hover:border-violet-500/70 rounded-lg p-3 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <Tag className="size-4 text-muted-foreground" />
                        <h3 className="font-medium font-mono text-sm truncate flex-1">
                          {tag.id}
                        </h3>
                      </div>
                      {info && info.childCount > 0 && (
                        <div className="mt-2 pt-2 border-t border-border">
                          <p className="text-xs text-violet-500 font-medium flex items-center gap-1">
                            <Package className="size-3" />
                            {info.childCount}{" "}
                            child{info.childCount > 1 ? "ren" : ""}
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
            )
        )}
      </div>

      <div className="space-y-2">
        <Label>Select Lago Customer</Label>

        {lagoCustomers.value.length === 0
          ? (
            <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Loading customers...
            </div>
          )
          : lagoCustomerId.value
          ? (
            <div className="border-2 border-violet-500 bg-violet-500/5 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <User className="size-5 text-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    {(() => {
                      const selectedCustomer = lagoCustomers.value.find((c) =>
                        c.id === lagoCustomerId.value
                      );
                      return selectedCustomer && (
                        <h3 className="font-semibold truncate">
                          {selectedCustomer.name}
                        </h3>
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
                  className="text-purple-600 hover:text-purple-600 hover:bg-purple-500/10 dark:text-purple-400 dark:hover:text-purple-400"
                >
                  Change
                </Button>
              </div>
            </div>
          )
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1">
              {lagoCustomers.value.map((customer) => (
                <div
                  key={customer.id}
                  onClick={() => {
                    lagoCustomerId.value = customer.id;
                    lagoSubscriptionId.value = "";
                  }}
                  className="border-2 border-border hover:border-violet-500/70 rounded-lg p-3 cursor-pointer transition-all"
                >
                  <div className="flex items-start gap-3">
                    <User className="size-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm truncate">
                        {customer.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                        {customer.id}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div className="space-y-2">
        <Label>
          Select Lago Subscription{" "}
          <span className="text-muted-foreground text-xs">(Optional)</span>
        </Label>

        {!lagoCustomerId.value
          ? (
            <div className="bg-muted rounded-lg p-4 text-center text-muted-foreground">
              Please select a customer first
            </div>
          )
          : filteredSubscriptions.value.length === 0
          ? (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-yellow-600 mb-1">
                    No Active Subscriptions
                  </h4>
                  <p className="text-sm text-yellow-600/80 mb-2">
                    This customer has no active subscriptions. You can still
                    save this mapping, but:
                  </p>
                  <ul className="text-sm text-yellow-600/80 list-disc list-inside space-y-1">
                    <li>The first active subscription will be auto-selected</li>
                    <li>The OCPP tag(s) will not be activated until an active subscription exists</li>
                  </ul>
                </div>
              </div>
            </div>
          )
          : lagoSubscriptionId.value
          ? (
            <div className="border-2 border-violet-500 bg-violet-500/5 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <CreditCard className="size-5 text-violet-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    {(() => {
                      const selectedSub = filteredSubscriptions.value.find(
                        (s) => s.id === lagoSubscriptionId.value,
                      );
                      return selectedSub && (
                        <>
                          <h3 className="font-semibold truncate">
                            {selectedSub.name}
                          </h3>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {selectedSub.id}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    lagoSubscriptionId.value = "";
                  }}
                  className="text-purple-600 hover:text-purple-600 hover:bg-purple-500/10 dark:text-purple-400 dark:hover:text-purple-400"
                >
                  Change
                </Button>
              </div>
            </div>
          )
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-1">
              {filteredSubscriptions.value.map((sub) => (
                <div
                  key={sub.id}
                  onClick={() => {
                    lagoSubscriptionId.value = sub.id;
                  }}
                  className="border-2 border-border hover:border-violet-500/70 rounded-lg p-3 cursor-pointer transition-all"
                >
                  <div className="flex items-start gap-3">
                    <CreditCard className="size-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm truncate">
                        {sub.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                        {sub.id}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="isActive"
          checked={isActive.value}
          onCheckedChange={(checked) => (isActive.value = checked)}
          className="border-purple-500 data-[state=checked]:bg-purple-600 data-[state=checked]:text-white"
        />
        <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" disabled={loading.value} className="bg-purple-600 hover:bg-purple-700 text-white">
          {loading.value
            ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving...
              </>
            )
            : (
              mapping ? "Update Mapping" : "Create Mapping"
            )}
        </Button>
        <Button variant="outline" asChild className="border-red-500 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400">
          <a href="/links">Cancel</a>
        </Button>
      </div>

      {/* Tap to Add Modal */}
      <TapToAddModal
        open={showTapToAdd.value}
        onOpenChange={(open) => (showTapToAdd.value = open)}
        onTagDetected={(tagId) => {
          // Check if this tag already exists
          const existingTag = ocppTags.value.find((t) => t.id === tagId);
          if (existingTag) {
            // Select the existing tag
            ocppTagId.value = existingTag.id;
            ocppTagPk.value = existingTag.ocppTagPk;
          } else {
            // Pre-fill the create new tag form
            showCreateTag.value = true;
            newTagId.value = tagId;
          }
        }}
      />
    </form>
  );
}
