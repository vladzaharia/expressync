#!/usr/bin/env -S deno run -A

// Load environment variables first
import "../src/lib/config.ts";
import { auth } from "../src/lib/auth.ts";

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL");
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD");
const ADMIN_NAME = Deno.env.get("ADMIN_NAME") || "Admin User";

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "❌ ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.",
  );
  console.error(
    "   Usage: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=yourpassword deno run -A scripts/seed-admin.ts",
  );
  Deno.exit(1);
}

if (ADMIN_PASSWORD.length < 12) {
  console.error("❌ ADMIN_PASSWORD must be at least 12 characters.");
  Deno.exit(1);
}

async function seedAdmin() {
  console.log("Creating admin user...");
  console.log(`Email: ${ADMIN_EMAIL}`);
  console.log(`Name: ${ADMIN_NAME}`);

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: ADMIN_EMAIL!,
        password: ADMIN_PASSWORD!,
        name: ADMIN_NAME,
      },
    });

    console.log("✅ Admin user created successfully!");
    console.log("User ID:", result.user?.id);
  } catch (error) {
    console.error("❌ Failed to create admin user:");
    console.error(error);
    Deno.exit(1);
  }
}

seedAdmin();
