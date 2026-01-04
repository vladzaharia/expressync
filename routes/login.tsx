import { define } from "../utils.ts";
import LoginForm from "../islands/LoginForm.tsx";
import { GridPattern } from "../components/magicui/grid-pattern.tsx";
import { Particles } from "../components/magicui/particles.tsx";
import { AuroraText } from "../components/magicui/aurora-text.tsx";
import { Ripple } from "../components/magicui/ripple.tsx";
import { ShineBorder } from "../components/magicui/shine-border.tsx";
import { Zap } from "lucide-preact";

export default define.page(function LoginPage() {
  return (
    <div class="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Animated particles background */}
      <Particles
        className="absolute inset-0 -z-5"
        quantity={80}
        staticity={30}
        color="#0ea5e9"
        size={0.6}
      />

      {/* Background pattern */}
      <GridPattern
        width={40}
        height={40}
        className="absolute inset-0 -z-10 opacity-10"
        squares={[[1, 1], [3, 3], [5, 2], [2, 5], [7, 4], [4, 7], [6, 1], [
          8,
          6,
        ]]}
      />

      {/* Gradient overlay */}
      <div class="absolute inset-0 -z-10 bg-gradient-to-br from-background via-background/95 to-primary/5" />

      <div class="relative z-10 w-full max-w-md px-4">
        {/* Logo with Ripple effect */}
        <div class="flex justify-center mb-8">
          <div class="flex items-center gap-3">
            <div class="relative">
              <Ripple
                mainCircleSize={80}
                mainCircleOpacity={0.15}
                numCircles={4}
                color="oklch(0.75 0.15 200)"
              />
              <div class="relative flex size-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg animate-pulse-glow">
                <Zap class="size-7" />
              </div>
            </div>
            <div class="flex flex-col">
              <AuroraText className="text-3xl font-bold">
                EV Billing
              </AuroraText>
              <span class="text-sm text-muted-foreground">OCPP Portal</span>
            </div>
          </div>
        </div>

        {/* Login form with shine border */}
        <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
          <LoginForm />
        </ShineBorder>

        {/* Footer */}
        <p class="mt-8 text-center text-xs text-muted-foreground">
          Secure access to your EV charging management system
        </p>
      </div>
    </div>
  );
});
