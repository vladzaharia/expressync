import { useSignal, useComputed } from "@preact/signals";
import { useEffect } from "preact/hooks";

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

  return (
    <form onSubmit={handleSubmit} class="space-y-6">
      {/* Progress indicator */}
      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-2">
          <div class={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep.value >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
            {currentStep.value > 1 ? '✓' : '1'}
          </div>
          <span class={`text-sm font-medium ${currentStep.value >= 1 ? 'text-blue-600' : 'text-gray-500'}`}>Tag</span>
        </div>
        <div class={`flex-1 h-1 mx-2 ${currentStep.value >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
        <div class="flex items-center gap-2">
          <div class={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep.value >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
            {currentStep.value > 2 ? '✓' : '2'}
          </div>
          <span class={`text-sm font-medium ${currentStep.value >= 2 ? 'text-blue-600' : 'text-gray-500'}`}>Customer</span>
        </div>
        <div class={`flex-1 h-1 mx-2 ${currentStep.value >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
        <div class="flex items-center gap-2">
          <div class={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep.value >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
            {currentStep.value > 3 ? '✓' : '3'}
          </div>
          <span class={`text-sm font-medium ${currentStep.value >= 3 ? 'text-blue-600' : 'text-gray-500'}`}>Subscription</span>
        </div>
        <div class={`flex-1 h-1 mx-2 ${currentStep.value >= 4 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
        <div class="flex items-center gap-2">
          <div class={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep.value >= 4 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
            {currentStep.value > 4 ? '✓' : '4'}
          </div>
          <span class={`text-sm font-medium ${currentStep.value >= 4 ? 'text-blue-600' : 'text-gray-500'}`}>Details</span>
        </div>
      </div>

      {error.value && (
        <div class="bg-red-50 text-red-700 p-3 rounded text-sm">
          {error.value}
        </div>
      )}

      {successMessage.value && (
        <div class="bg-green-50 text-green-700 p-3 rounded text-sm">
          {successMessage.value}
        </div>
      )}

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          Select OCPP Tag
        </label>

        {availableTags.value.length === 0 ? (
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-600">
            No available tags to map. All tags have been mapped.
          </div>
        ) : ocppTagId.value ? (
          // Compact selected view
          <div class="border border-blue-500 bg-blue-50 rounded-lg p-4">
            <div class="flex items-start justify-between">
              <div class="flex items-start gap-2 flex-1">
                <span class="text-xl">🏷️</span>
                <div class="flex-1">
                  <h3 class="font-semibold text-gray-900 font-mono">
                    {ocppTagId.value}
                  </h3>
                  {(() => {
                    const selectedTag = availableTags.value.find(t => t.id === ocppTagId.value);
                    return selectedTag?.note && (
                      <p class="text-sm text-gray-600 mt-1">{selectedTag.note}</p>
                    );
                  })()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  ocppTagId.value = "";
                  ocppTagPk.value = 0;
                }}
                class="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          // Full selection view
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
            {availableTags.value.map((tag) => {
              const info = tagInfoMap.value.get(tag.id);

              return (
                <div
                  key={tag.id}
                  onClick={() => {
                    ocppTagId.value = tag.id;
                    ocppTagPk.value = tag.ocppTagPk;
                  }}
                  class="border border-gray-300 hover:border-blue-300 hover:bg-gray-50 rounded-lg p-4 cursor-pointer transition-all"
                >
                  <div class="flex items-start gap-2">
                    <span class="text-xl">🏷️</span>
                    <div class="flex-1">
                      <h3 class="font-semibold text-gray-900 font-mono text-sm">
                        {tag.id}
                      </h3>
                      {tag.note && (
                        <p class="text-xs text-gray-600 mt-1">{tag.note}</p>
                      )}
                    </div>
                  </div>

                  {info && info.childCount > 0 && (
                    <div class="mt-2 pt-2 border-t border-gray-200">
                      <p class="text-xs text-blue-600 font-medium">
                        📦 {info.childCount} child{info.childCount > 1 ? "ren" : ""}
                      </p>
                    </div>
                  )}

                  {info && info.mappedParent && (
                    <div class="mt-2 pt-2 border-t border-amber-200 bg-amber-50 -mx-4 -mb-4 px-4 py-2 rounded-b-lg">
                      <p class="text-xs text-amber-800 font-medium">
                        ⚠️ Parent mapped
                      </p>
                      <p class="text-xs text-amber-700 mt-1">
                        Will override inheritance
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          Select Lago Customer
        </label>

        {lagoCustomers.value.length === 0 ? (
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-600">
            Loading customers...
          </div>
        ) : lagoCustomerId.value ? (
          // Compact selected view
          <div class="border border-blue-500 bg-blue-50 rounded-lg p-4">
            <div class="flex items-start justify-between">
              <div class="flex items-start gap-2 flex-1">
                <span class="text-xl">👤</span>
                <div class="flex-1">
                  {(() => {
                    const selectedCustomer = lagoCustomers.value.find(c => c.id === lagoCustomerId.value);
                    return selectedCustomer && (
                      <>
                        <h3 class="font-semibold text-gray-900">
                          {selectedCustomer.name}
                        </h3>
                      </>
                    );
                  })()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  lagoCustomerId.value = "";
                  lagoSubscriptionId.value = "";
                }}
                class="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          // Full selection view
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
            {lagoCustomers.value.map((customer) => {
              return (
                <div
                  key={customer.id}
                  onClick={() => {
                    lagoCustomerId.value = customer.id;
                    lagoSubscriptionId.value = "";
                  }}
                  class="border border-gray-300 hover:border-blue-300 hover:bg-gray-50 rounded-lg p-4 cursor-pointer transition-all"
                >
                  <div class="flex items-start gap-2">
                    <span class="text-xl">👤</span>
                    <div class="flex-1">
                      <h3 class="font-semibold text-gray-900 text-sm">
                        {customer.name}
                      </h3>
                      <p class="text-xs text-gray-500 mt-1 font-mono">
                        {customer.id}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          Select Lago Subscription <span class="text-gray-500 text-xs">(Optional)</span>
        </label>

        {!lagoCustomerId.value ? (
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-600">
            Please select a customer first
          </div>
        ) : filteredSubscriptions.value.length === 0 ? (
          <div class="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
            <div class="flex items-start gap-3">
              <span class="text-2xl">⚠️</span>
              <div class="flex-1">
                <h4 class="font-semibold text-yellow-900 mb-1">No Active Subscriptions</h4>
                <p class="text-sm text-yellow-800 mb-2">
                  This customer has no active subscriptions. You can still save this mapping, but:
                </p>
                <ul class="text-sm text-yellow-800 list-disc list-inside space-y-1 mb-2">
                  <li>Transactions will be saved but not sent to Lago</li>
                  <li>The first active subscription will be auto-selected when syncing</li>
                  <li>You should create a subscription for this customer before they start charging</li>
                </ul>
              </div>
            </div>
          </div>
        ) : lagoSubscriptionId.value ? (
          // Compact selected view
          <div class="border border-blue-500 bg-blue-50 rounded-lg p-4">
            <div class="flex items-start justify-between">
              <div class="flex items-start gap-2 flex-1">
                <span class="text-xl">💳</span>
                <div class="flex-1">
                  {(() => {
                    const selectedSub = filteredSubscriptions.value.find(s => s.id === lagoSubscriptionId.value);
                    return selectedSub && (
                      <>
                        <h3 class="font-semibold text-gray-900">
                          {selectedSub.name}
                        </h3>
                        <p class="text-xs text-gray-500 mt-1 font-mono">
                          {selectedSub.id}
                        </p>
                      </>
                    );
                  })()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  lagoSubscriptionId.value = "";
                }}
                class="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          // Full selection view
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
            {filteredSubscriptions.value.map((sub) => {
              return (
                <div
                  key={sub.id}
                  onClick={() => {
                    lagoSubscriptionId.value = sub.id;
                  }}
                  class="border border-gray-300 hover:border-blue-300 hover:bg-gray-50 rounded-lg p-4 cursor-pointer transition-all"
                >
                  <div class="flex items-start gap-2">
                    <span class="text-xl">💳</span>
                    <div class="flex-1">
                      <h3 class="font-semibold text-gray-900 text-sm">
                        {sub.name}
                      </h3>
                      <p class="text-xs text-gray-500 mt-1 font-mono">
                        {sub.id}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Display Name (Optional)
        </label>
        <input
          type="text"
          value={displayName.value}
          onChange={(e) =>
            (displayName.value = (e.target as HTMLInputElement).value)}
          class="w-full px-3 py-2 border border-gray-300 rounded-md"
          placeholder="Friendly name for this mapping"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Notes (Optional)
        </label>
        <textarea
          value={notes.value}
          onChange={(e) =>
            (notes.value = (e.target as HTMLTextAreaElement).value)}
          class="w-full px-3 py-2 border border-gray-300 rounded-md"
          rows={3}
          placeholder="Additional notes about this mapping"
        />
      </div>

      <div class="flex items-center">
        <input
          type="checkbox"
          id="isActive"
          checked={isActive.value}
          onChange={(e) =>
            (isActive.value = (e.target as HTMLInputElement).checked)}
          class="h-4 w-4 text-blue-600 border-gray-300 rounded"
        />
        <label for="isActive" class="ml-2 text-sm text-gray-700">
          Active
        </label>
      </div>

      <div class="flex gap-4">
        <button
          type="submit"
          disabled={loading.value}
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading.value ? "Saving..." : mapping ? "Update" : "Create"}
        </button>
        <a
          href="/mappings"
          class="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

