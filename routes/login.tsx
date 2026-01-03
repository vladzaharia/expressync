import { define } from "../utils.ts";
import LoginForm from "../islands/LoginForm.tsx";

export default define.page(function LoginPage() {
  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-100">
      <div class="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 class="text-center text-3xl font-bold text-gray-900">
            EV Billing Portal
          </h2>
          <p class="mt-2 text-center text-sm text-gray-600">
            Sign in to your account
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
});

