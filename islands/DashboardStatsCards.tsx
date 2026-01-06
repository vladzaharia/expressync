import { useState } from "preact/hooks";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { NumberTicker } from "@/components/magicui/number-ticker.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { CheckCircle2, CreditCard, Users, XCircle, Zap } from "lucide-preact";

interface DashboardStats {
  tags: {
    active: number;
    blocked: number;
  };
  lago: {
    customers: number;
    subscriptions: number;
  };
  kwh: {
    day: number;
    week: number;
    month: number;
  };
  syncSuccess: {
    day: number;
    week: number;
    month: number;
  };
}

interface Props {
  stats: DashboardStats;
}

type Timeframe = "day" | "week" | "month";

const defaultStats: DashboardStats = {
  tags: { active: 0, blocked: 0 },
  lago: { customers: 0, subscriptions: 0 },
  kwh: { day: 0, week: 0, month: 0 },
  syncSuccess: { day: 100, week: 100, month: 100 },
};

export default function DashboardStatsCards({ stats: propStats }: Props) {
  // Merge with defaults to handle undefined/null values
  const stats = {
    tags: { ...defaultStats.tags, ...propStats?.tags },
    lago: { ...defaultStats.lago, ...propStats?.lago },
    kwh: { ...defaultStats.kwh, ...propStats?.kwh },
    syncSuccess: { ...defaultStats.syncSuccess, ...propStats?.syncSuccess },
  };

  const [kwhTimeframe, setKwhTimeframe] = useState<Timeframe>("day");
  const [syncTimeframe, setSyncTimeframe] = useState<Timeframe>("day");

  const kwhValue = stats.kwh[kwhTimeframe] ?? 0;
  const syncSuccessValue = stats.syncSuccess[syncTimeframe] ?? 100;

  return (
    <div className="grid grid-rows-4 gap-3 h-full">
      {/* Card 1: Active/Blocked Tags */}
      <Card className="relative overflow-hidden flex flex-col">
        <BorderBeam size={250} duration={12} delay={9} />
        <CardHeader className="py-2 flex-shrink-0">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Users className="size-4" />
            OCPP Tags
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 flex-1 flex items-center">
          <div className="grid grid-cols-2 gap-4 w-full">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="size-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Active</span>
              </div>
              <div className="text-2xl font-bold">
                <NumberTicker value={stats.tags.active} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="size-4 text-red-500" />
                <span className="text-xs text-muted-foreground">Blocked</span>
              </div>
              <div className="text-2xl font-bold">
                <NumberTicker value={stats.tags.blocked} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Customers/Subscriptions */}
      <Card className="relative overflow-hidden flex flex-col">
        <BorderBeam size={250} duration={12} delay={6} />
        <CardHeader className="py-2 flex-shrink-0">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <CreditCard className="size-4" />
            Lago Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 flex-1 flex items-center">
          <div className="grid grid-cols-2 gap-4 w-full">
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Customers
              </div>
              <div className="text-2xl font-bold">
                <NumberTicker value={stats.lago.customers} />
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Subscriptions
              </div>
              <div className="text-2xl font-bold">
                <NumberTicker value={stats.lago.subscriptions} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: kWh Delivered */}
      <Card className="relative overflow-hidden flex flex-col">
        <BorderBeam size={250} duration={12} delay={3} />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-2 flex-shrink-0">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Zap className="size-4" />
            Energy Delivered
          </CardTitle>
          <ToggleGroup
            type="single"
            value={kwhTimeframe}
            onValueChange={(value: string) =>
              value && setKwhTimeframe(value as Timeframe)}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="day" aria-label="Day">D</ToggleGroupItem>
            <ToggleGroupItem value="week" aria-label="Week">W</ToggleGroupItem>
            <ToggleGroupItem value="month" aria-label="Month">
              M
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent className="py-2 flex-1 flex items-center">
          <div className="text-3xl font-bold">
            <NumberTicker value={kwhValue} decimalPlaces={2} />
            <span className="text-lg font-normal text-muted-foreground ml-2">
              kWh
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Card 4: Sync Success Rate */}
      <Card className="relative overflow-hidden flex flex-col">
        <BorderBeam size={250} duration={12} delay={15} />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-2 flex-shrink-0">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            Sync Success
          </CardTitle>
          <ToggleGroup
            type="single"
            value={syncTimeframe}
            onValueChange={(value: string) =>
              value && setSyncTimeframe(value as Timeframe)}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="day" aria-label="Day">D</ToggleGroupItem>
            <ToggleGroupItem value="week" aria-label="Week">W</ToggleGroupItem>
            <ToggleGroupItem value="month" aria-label="Month">
              M
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent className="py-2 flex-1 flex items-center">
          <div className="text-3xl font-bold">
            <NumberTicker value={syncSuccessValue} />
            <span className="text-lg font-normal text-muted-foreground ml-1">
              %
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
