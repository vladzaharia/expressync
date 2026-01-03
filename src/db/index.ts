import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

// Get database URL from environment
const DATABASE_URL = Deno.env.get("DATABASE_URL");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Create postgres.js client
// For migrations, use max: 1 connection
// For queries, use default connection pool
const queryClient = postgres(DATABASE_URL);

// Create Drizzle instance with schema
export const db = drizzle(queryClient, { schema });

// Export schema for use in queries
export * from "./schema.ts";

// Graceful shutdown helper
export async function closeDatabase() {
  await queryClient.end();
}

