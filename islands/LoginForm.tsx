import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Loader2 } from "lucide-preact";

export default function LoginForm() {
  const email = useSignal("");
  const password = useSignal("");
  const loading = useSignal(false);
  const error = useSignal("");

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    loading.value = true;
    error.value = "";

    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.value,
          password: password.value,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        window.location.href = "/";
      } else {
        error.value = data.error?.message || data.message ||
                     `Login failed (${res.status}). Please check your credentials.`;
      }
    } catch (e) {
      console.error("Login error:", e);
      error.value = `An error occurred: ${e.message || "Please try again."}`;
    } finally {
      loading.value = false;
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold text-center">Welcome back</CardTitle>
        <CardDescription className="text-center">
          Enter your credentials to access the portal
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error.value && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm border border-destructive/20">
              {error.value}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="admin@example.com"
              required
              value={email.value}
              onInput={(e) => (email.value = (e.target as HTMLInputElement).value)}
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              required
              value={password.value}
              onInput={(e) => (password.value = (e.target as HTMLInputElement).value)}
              autoComplete="current-password"
            />
          </div>

          <Button
            type="submit"
            disabled={loading.value}
            className="w-full"
          >
            {loading.value ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

