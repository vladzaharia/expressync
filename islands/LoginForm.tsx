import { useSignal } from "@preact/signals";

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
      console.log("Login response:", { status: res.status, data });

      if (res.ok) {
        // Redirect to dashboard
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
    <form onSubmit={handleSubmit} class="mt-8 space-y-6">
      {error.value && (
        <div class="bg-red-50 text-red-700 p-3 rounded text-sm">
          {error.value}
        </div>
      )}

      <div class="space-y-4">
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email.value}
            onInput={(e) => (email.value = (e.target as HTMLInputElement).value)}
            class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                   focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={password.value}
            onInput={(e) => (password.value = (e.target as HTMLInputElement).value)}
            class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                   focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading.value}
        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md
               shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
               focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
               disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading.value ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

