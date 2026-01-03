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

  // Compute child tags count for selected tag
  const selectedTagInfo = useComputed(() => {
    const tag = ocppTags.value.find((t) => t.id === ocppTagId.value);
    if (!tag) return null;

    const childCount = ocppTags.value.filter(
      (t) => t.parentIdTag === tag.id
    ).length;

    return {
      tag,
      childCount,
      hasChildren: childCount > 0,
    };
  });

  useEffect(() => {
    // Fetch OCPP tags
    fetch("/api/steve/ocpp-tags")
      .then((res) => res.json())
      .then((data) => (ocppTags.value = data))
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

  return (
    <form onSubmit={handleSubmit} class="space-y-6">
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
        <label class="block text-sm font-medium text-gray-700 mb-1">
          OCPP Tag
        </label>
        <select
          required
          value={ocppTagId.value}
          onChange={(e) => {
            const selectedId = (e.target as HTMLSelectElement).value;
            ocppTagId.value = selectedId;
            const tag = ocppTags.value.find((t) => t.id === selectedId);
            if (tag) {
              ocppTagPk.value = tag.ocppTagPk;
            }
          }}
          class="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="">Select OCPP Tag</option>
          {ocppTags.value.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.id} {tag.note ? `- ${tag.note}` : ""}
            </option>
          ))}
        </select>
        {selectedTagInfo.value?.hasChildren && (
          <p class="mt-1 text-sm text-blue-600">
            ℹ️ This tag has {selectedTagInfo.value.childCount} child tag(s).
            Creating this mapping will automatically create mappings for all child tags.
          </p>
        )}
        {selectedTagInfo.value?.tag.parentIdTag && (
          <p class="mt-1 text-sm text-gray-600">
            Parent tag: {selectedTagInfo.value.tag.parentIdTag}
          </p>
        )}
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Lago Customer
        </label>
        <select
          required
          value={lagoCustomerId.value}
          onChange={(e) =>
            (lagoCustomerId.value = (e.target as HTMLSelectElement).value)}
          class="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="">Select Customer</option>
          {lagoCustomers.value.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Lago Subscription
        </label>
        <select
          required
          value={lagoSubscriptionId.value}
          onChange={(e) =>
            (lagoSubscriptionId.value = (e.target as HTMLSelectElement).value)}
          class="w-full px-3 py-2 border border-gray-300 rounded-md"
          disabled={!lagoCustomerId.value}
        >
          <option value="">Select Subscription</option>
          {filteredSubscriptions.value.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {sub.name}
            </option>
          ))}
        </select>
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

