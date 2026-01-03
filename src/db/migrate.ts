import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Get database URL from environment
const DATABASE_URL = Deno.env.get("DATABASE_URL");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Create a migration client with max 1 connection
const migrationClient = postgres(DATABASE_URL, { max: 1 });

// Create Drizzle instance for migrations
const db = drizzle(migrationClient);

console.log("Running database migrations...");

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ Migrations completed successfully");
} catch (error) {
  console.error("❌ Migration failed:", error);
  throw error;
} finally {
  await migrationClient.end();
}

