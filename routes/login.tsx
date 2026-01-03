import { define } from "../utils.ts";
import LoginForm from "../islands/LoginForm.tsx";
import { GridPattern } from "../components/magicui/grid-pattern.tsx";
import { Zap } from "lucide-preact";

export default define.page(function LoginPage() {
  return (
    <div class="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background pattern */}
      <GridPattern
        width={40}
        height={40}
        className="absolute inset-0 -z-10 opacity-20"
        squares={[[1, 1], [3, 3], [5, 2], [2, 5], [7, 4]]}
      />

      {/* Gradient overlay */}
      <div class="absolute inset-0 -z-10 bg-gradient-to-br from-background via-background to-muted" />

      <div class="relative z-10 w-full max-w-md px-4">
        {/* Logo */}
        <div class="flex justify-center mb-8">
          <div class="flex items-center gap-3">
            <div class="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
              <Zap class="size-6" />
            </div>
            <div class="flex flex-col">
              <span class="text-2xl font-bold">EV Billing</span>
              <span class="text-sm text-muted-foreground">OCPP Portal</span>
            </div>
          </div>
        </div>

        <LoginForm />

        {/* Footer */}
        <p class="mt-8 text-center text-xs text-muted-foreground">
          Secure access to your EV charging management system
        </p>
      </div>
    </div>
  );
});

