import { defineConfig } from "drizzle-kit";

// Hardcode for now - drizzle-kit runs in Node.js mode
const DATABASE_URL = "postgresql://ocpp_user:ocpp_password@localhost:5432/ocpp_billing";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
});

