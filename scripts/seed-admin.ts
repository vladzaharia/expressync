#!/usr/bin/env -S deno run -A

// Load environment variables first
import "../src/lib/config.ts";
import { auth } from "../src/lib/auth.ts";

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "admin@example.com";
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin123456";
const ADMIN_NAME = Deno.env.get("ADMIN_NAME") || "Admin User";

async function seedAdmin() {
  console.log("Creating admin user...");
  console.log(`Email: ${ADMIN_EMAIL}`);
  console.log(`Name: ${ADMIN_NAME}`);

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        name: ADMIN_NAME,
      },
    });

    console.log("✅ Admin user created successfully!");
    console.log("User ID:", result.user?.id);
    console.log("\nYou can now login with:");
    console.log(`  Email: ${ADMIN_EMAIL}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
  } catch (error) {
    console.error("❌ Failed to create admin user:");
    console.error(error);
    Deno.exit(1);
  }
}

seedAdmin();

