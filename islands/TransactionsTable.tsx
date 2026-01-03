import { useSignal } from "@preact/signals";

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
    <div class="space-y-4">
      <div class="bg-white shadow rounded-lg p-4">
        <div class="flex gap-4 items-end">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={startDate.value}
              onInput={(e) =>
                (startDate.value = (e.target as HTMLInputElement).value)}
              class="px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate.value}
              onInput={(e) =>
                (endDate.value = (e.target as HTMLInputElement).value)}
              class="px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <button
            onClick={handleFilter}
            disabled={loading.value}
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading.value ? "Filtering..." : "Filter"}
          </button>
        </div>
      </div>

      <div class="bg-white shadow rounded-lg overflow-hidden">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-medium">
                Transaction ID
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium">OCPP Tag</th>
              <th class="px-6 py-3 text-left text-xs font-medium">kWh</th>
              <th class="px-6 py-3 text-left text-xs font-medium">
                Lago Event ID
              </th>
              <th class="px-6 py-3 text-left text-xs font-medium">
                Synced At
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            {events.value.length === 0
              ? (
                <tr>
                  <td colSpan={5} class="px-6 py-8 text-center text-gray-500">
                    No billing events found
                  </td>
                </tr>
              )
              : events.value.map((event) => (
                <tr key={event.id}>
                  <td class="px-6 py-4 text-sm">{event.transactionId}</td>
                  <td class="px-6 py-4 text-sm">{event.ocppTagId}</td>
                  <td class="px-6 py-4 text-sm">
                    {event.kwhDelta.toFixed(2)}
                  </td>
                  <td class="px-6 py-4 text-sm font-mono text-xs">
                    {event.lagoEventId}
                  </td>
                  <td class="px-6 py-4 text-sm">
                    {new Date(event.syncedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

