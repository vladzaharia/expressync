import { useSignal } from "@preact/signals";

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
        // Refresh the page to show updated mappings after deletion
        if (data.deletedCount && data.deletedCount > 1) {
          alert(`Deleted ${data.deletedCount} mappings (1 parent + ${data.deletedCount - 1} children)`);
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
        // Refresh to show updated status for parent and children
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
      <div class="bg-white shadow rounded-lg p-8 text-center text-gray-500">
        No mappings found. Create your first mapping to get started.
      </div>
    );
  }

  return (
    <div class="bg-white shadow rounded-lg overflow-hidden">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium">OCPP Tag</th>
            <th class="px-6 py-3 text-left text-xs font-medium">
              Display Name
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium">
              Lago Customer
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium">
              Subscription
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium">Status</th>
            <th class="px-6 py-3 text-left text-xs font-medium">Notes</th>
            <th class="px-6 py-3 text-left text-xs font-medium">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          {mappings.value.map((mapping) => {
            const isChildMapping = mapping.notes?.includes("Auto-created from parent");
            return (
              <tr key={mapping.id} class={isChildMapping ? "bg-blue-50" : ""}>
                <td class="px-6 py-4 text-sm font-mono">
                  {isChildMapping && <span class="text-gray-400 mr-1">↳</span>}
                  {mapping.steveOcppIdTag}
                </td>
                <td class="px-6 py-4 text-sm">{mapping.displayName || "-"}</td>
                <td class="px-6 py-4 text-sm">{mapping.lagoCustomerExternalId}</td>
                <td class="px-6 py-4 text-sm">{mapping.lagoSubscriptionExternalId}</td>
                <td class="px-6 py-4 text-sm">
                  <button
                    onClick={() =>
                      handleToggleActive(mapping.id, mapping.isActive)}
                    class={`px-2 py-1 text-xs rounded ${
                      mapping.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {mapping.isActive ? "Active" : "Inactive"}
                  </button>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={mapping.notes || ""}>
                  {mapping.notes || "-"}
                </td>
                <td class="px-6 py-4 text-sm space-x-2">
                  <a
                    href={`/mappings/${mapping.id}`}
                    class="text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </a>
                  <button
                    onClick={() => handleDelete(mapping.id)}
                    disabled={deleting.value === mapping.id}
                    class="text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    {deleting.value === mapping.id ? "Deleting..." : "Delete"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

