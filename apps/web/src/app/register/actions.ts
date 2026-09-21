"use server";

import { getDbPool } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { signIn } from "@/auth";

export async function registerUser(formData: FormData) {
  const displayName = formData.get("displayName") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!email || !password || !confirmPassword) {
    return { error: "Missing required fields" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters long" };
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const pool = getDbPool();

    // Check if email already exists
    const existingUser = await pool.query("SELECT id FROM studio_users WHERE email = $1", [normalizedEmail]);
    if (existingUser.rows.length > 0) {
      // Return a generic error or specific error based on policy
      return { error: "A user with this email already exists" };
    }

    const userId = randomUUID();
    const tenantId = randomUUID(); // Provision a new private tenant
    const passwordHash = await bcrypt.hash(password, 12); // Work factor 12

    await pool.query(
      `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [userId, normalizedEmail, passwordHash, displayName || null, tenantId]
    );

    // Auto sign-in the newly created user so they land directly on the home page
    await signIn("credentials", { email: normalizedEmail, password, redirect: false });

    return { success: true };
  } catch (error) {
    console.error("Registration error:", error);
    const code = (error as { code?: string } | null)?.code;
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
      return { error: "Registration is temporarily unavailable. Please try again in a moment." };
    }
    return { error: "An unexpected error occurred during registration" };
  }
}
