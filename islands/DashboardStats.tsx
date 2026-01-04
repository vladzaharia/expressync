import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { NumberTicker } from "@/components/magicui/number-ticker.tsx";
import { ShineBorder } from "@/components/magicui/shine-border.tsx";
import { CalendarDays, Link2, Zap } from "lucide-preact";

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
      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={10}
        color={["oklch(0.75 0.15 200)", "oklch(0.70 0.22 280)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Links
            </CardTitle>
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Link2 className="size-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              <NumberTicker value={stats.totalMappings} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-accent font-medium">
                {stats.activeMappings}
              </span>{" "}
              active
            </p>
          </CardContent>
        </Card>
      </ShineBorder>

      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={10}
        color={["oklch(0.75 0.22 145)", "oklch(0.75 0.15 200)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today's Transactions
            </CardTitle>
            <div className="flex size-8 items-center justify-center rounded-lg bg-accent/10">
              <Zap className="size-4 text-accent" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-accent">
              <NumberTicker value={stats.todayTransactions} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-primary font-medium">
                <NumberTicker value={stats.todayKwh} decimalPlaces={2} />
              </span>{" "}
              kWh delivered
            </p>
          </CardContent>
        </Card>
      </ShineBorder>

      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={10}
        color={["oklch(0.70 0.22 280)", "oklch(0.75 0.22 145)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              This Week
            </CardTitle>
            <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10">
              <CalendarDays className="size-4 text-violet-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              <NumberTicker value={stats.weekTransactions} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-accent font-medium">
                <NumberTicker value={stats.weekKwh} decimalPlaces={2} />
              </span>{" "}
              kWh total
            </p>
          </CardContent>
        </Card>
      </ShineBorder>
    </div>
  );
}
