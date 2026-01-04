interface Props {
  user: {
    id: string;
    name: string | null;
    email: string;
    emailVerified: boolean;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

export default function Navbar({ user }: Props) {
  return (
    <nav class="bg-white shadow">
      <div class="container mx-auto px-4">
        <div class="flex justify-between h-16">
          <div class="flex items-center space-x-8">
            <a href="/" class="text-xl font-bold text-gray-900">
              ExpresSync
            </a>
            <a href="/links" class="text-gray-600 hover:text-gray-900">
              Tag Linking
            </a>
            <a href="/transactions" class="text-gray-600 hover:text-gray-900">
              Transactions
            </a>
            <a href="/sync" class="text-gray-600 hover:text-gray-900">
              Sync
            </a>
          </div>
          <div class="flex items-center space-x-4">
            <span class="text-sm text-gray-600">{user.email}</span>
            <form action="/api/auth/sign-out" method="POST">
              <button
                type="submit"
                class="text-sm text-red-600 hover:text-red-800"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </div>
    </nav>
  );
}
