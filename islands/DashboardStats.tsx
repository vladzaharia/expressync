import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { NumberTicker } from "@/components/magicui/number-ticker.tsx";
import { ShineBorder } from "@/components/magicui/shine-border.tsx";
import { CalendarDays, CreditCard, Link2, Tag, User, Zap } from "lucide-preact";

interface Props {
  stats: {
    totalMappings: number;
    activeMappings: number;
    blockedMappings: number;
    totalTags: number;
    totalCustomers: number;
    totalSubscriptions: number;
    todayTransactions: number;
    todayKwh: number;
    weekTransactions: number;
    weekKwh: number;
  };
}

export default function DashboardStats({ stats }: Props) {
  return (
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {/* OCPP Tags */}
      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={12}
        color={["oklch(0.70 0.22 280)", "oklch(0.75 0.15 200)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              OCPP Tags
            </CardTitle>
            <div className="flex size-7 items-center justify-center rounded-lg bg-violet-500/10">
              <Tag className="size-3.5 text-violet-500" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-violet-500">
              <NumberTicker value={stats.totalTags} />
            </div>
            <p className="text-xs text-muted-foreground">
              in StEvE
            </p>
          </CardContent>
        </Card>
      </ShineBorder>

      {/* Tag Links */}
      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={12}
        color={["oklch(0.75 0.15 200)", "oklch(0.70 0.22 280)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Tag Links
            </CardTitle>
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
              <Link2 className="size-3.5 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-primary">
              <NumberTicker value={stats.activeMappings} />
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-destructive">{stats.blockedMappings}</span>
              {" "}
              blocked
            </p>
          </CardContent>
        </Card>
      </ShineBorder>

      {/* Customers */}
      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={12}
        color={["oklch(0.75 0.22 145)", "oklch(0.75 0.15 200)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Customers
            </CardTitle>
            <div className="flex size-7 items-center justify-center rounded-lg bg-green-500/10">
              <User className="size-3.5 text-green-500" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-green-500">
              <NumberTicker value={stats.totalCustomers} />
            </div>
            <p className="text-xs text-muted-foreground">
              in Lago
            </p>
          </CardContent>
        </Card>
      </ShineBorder>

      {/* Subscriptions */}
      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={12}
        color={["oklch(0.75 0.15 200)", "oklch(0.75 0.22 145)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Subscriptions
            </CardTitle>
            <div className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10">
              <CreditCard className="size-3.5 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-blue-500">
              <NumberTicker value={stats.totalSubscriptions} />
            </div>
            <p className="text-xs text-muted-foreground">
              active
            </p>
          </CardContent>
        </Card>
      </ShineBorder>

      {/* Today's Transactions */}
      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={12}
        color={["oklch(0.75 0.22 145)", "oklch(0.75 0.15 200)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Today
            </CardTitle>
            <div className="flex size-7 items-center justify-center rounded-lg bg-accent/10">
              <Zap className="size-3.5 text-accent" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-accent">
              <NumberTicker value={stats.todayTransactions} />
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-primary font-medium">
                <NumberTicker value={stats.todayKwh} decimalPlaces={1} />
              </span>{" "}
              kWh
            </p>
          </CardContent>
        </Card>
      </ShineBorder>

      {/* This Week */}
      <ShineBorder
        borderRadius={12}
        borderWidth={1}
        duration={12}
        color={["oklch(0.70 0.22 280)", "oklch(0.75 0.22 145)"]}
      >
        <Card className="border-0 shadow-none h-full">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              This Week
            </CardTitle>
            <div className="flex size-7 items-center justify-center rounded-lg bg-violet-500/10">
              <CalendarDays className="size-3.5 text-violet-500" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold">
              <NumberTicker value={stats.weekTransactions} />
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-accent font-medium">
                <NumberTicker value={stats.weekKwh} decimalPlaces={1} />
              </span>{" "}
              kWh
            </p>
          </CardContent>
        </Card>
      </ShineBorder>
    </div>
  );
}
