interface Props {
  stats: {
    totalMappings: number;
    activeMappings: number;
    todayTransactions: number;
    todayKwh: number;
    weekTransactions: number;
    weekKwh: number;
  };
}

export default function DashboardStats({ stats }: Props) {
  return (
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-sm font-medium text-gray-500">Total Mappings</h3>
        <p class="text-3xl font-bold text-gray-900 mt-2">
          {stats.totalMappings}
        </p>
        <p class="text-sm text-gray-600 mt-1">
          {stats.activeMappings} active
        </p>
      </div>

      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-sm font-medium text-gray-500">Today's Transactions</h3>
        <p class="text-3xl font-bold text-gray-900 mt-2">
          {stats.todayTransactions}
        </p>
        <p class="text-sm text-gray-600 mt-1">
          {stats.todayKwh.toFixed(2)} kWh
        </p>
      </div>

      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-sm font-medium text-gray-500">This Week</h3>
        <p class="text-3xl font-bold text-gray-900 mt-2">
          {stats.weekTransactions}
        </p>
        <p class="text-sm text-gray-600 mt-1">
          {stats.weekKwh.toFixed(2)} kWh
        </p>
      </div>
    </div>
  );
}

