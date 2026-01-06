import { define } from "../utils.ts";
import LoginForm from "../islands/LoginForm.tsx";
import { GridPattern } from "../components/magicui/grid-pattern.tsx";
import { Particles } from "../components/magicui/particles.tsx";
import { Ripple } from "../components/magicui/ripple.tsx";
import { ShineBorder } from "../components/magicui/shine-border.tsx";
import { ExpresSyncBrand } from "../components/brand/ExpresSyncBrand.tsx";
import { BlurFade } from "../components/magicui/blur-fade.tsx";

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
        <BlurFade delay={0} duration={0.5} direction="down">
          <div class="flex justify-center mb-8">
            <div class="relative">
              <ExpresSyncBrand
                variant="login"
                showParticles={true}
              />
            </div>
          </div>
        </BlurFade>

        {/* Login form with shine border */}
        <BlurFade delay={0.2} duration={0.5} direction="up">
          <ShineBorder borderRadius={12} borderWidth={1} duration={10}>
            <LoginForm />
          </ShineBorder>
        </BlurFade>
      </div>
    </div>
  );
});
