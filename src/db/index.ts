import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// Lazy initialisation so modules that transitively import `db` can still load
// in environments without DATABASE_URL (e.g. unit tests that exercise
// fail-open branches without touching the database). The error is deferred
// until the caller actually tries to run a query.
let queryClient: ReturnType<typeof postgres> | null = null;
let drizzleInstance: DrizzleDb | null = null;

function initDb(): DrizzleDb {
  if (drizzleInstance) return drizzleInstance;
  const DATABASE_URL = Deno.env.get("DATABASE_URL");
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  queryClient = postgres(DATABASE_URL);
  drizzleInstance = drizzle(queryClient, { schema });
  return drizzleInstance;
}

export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const real = initDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as DrizzleDb;

// Export schema for use in queries
export * from "./schema.ts";

// Graceful shutdown helper
export async function closeDatabase() {
  if (queryClient) {
    await queryClient.end();
  }
}
