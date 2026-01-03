import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { MagicCard } from "@/components/magicui/magic-card.tsx";
import { NumberTicker } from "@/components/magicui/number-ticker.tsx";
import { Link2, Zap, CalendarDays } from "lucide-preact";

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
      <MagicCard className="border-0 shadow-none">
        <Card className="border-0 bg-transparent shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Mappings
            </CardTitle>
            <Link2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              <NumberTicker value={stats.totalMappings} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.activeMappings} active
            </p>
          </CardContent>
        </Card>
      </MagicCard>

      <MagicCard className="border-0 shadow-none">
        <Card className="border-0 bg-transparent shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today's Transactions
            </CardTitle>
            <Zap className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              <NumberTicker value={stats.todayTransactions} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <NumberTicker value={stats.todayKwh} decimalPlaces={2} /> kWh
            </p>
          </CardContent>
        </Card>
      </MagicCard>

      <MagicCard className="border-0 shadow-none">
        <Card className="border-0 bg-transparent shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              This Week
            </CardTitle>
            <CalendarDays className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              <NumberTicker value={stats.weekTransactions} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <NumberTicker value={stats.weekKwh} decimalPlaces={2} /> kWh
            </p>
          </CardContent>
        </Card>
      </MagicCard>
    </div>
  );
}

