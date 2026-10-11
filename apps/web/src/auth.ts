import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getDbPool } from "@/lib/db";

import type { NextAuthConfig } from "next-auth";

// Keep this error independent from the optional runtime export so auth tests and
// NextAuth's mocked module can still represent a typed credentials failure.
class DatabaseUnavailableError extends Error {
  code = "AUTH_DATABASE_UNAVAILABLE";

  constructor() {
    super("Authentication database is temporarily unavailable.");
    this.name = "CredentialsSignin";
  }
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [
    Credentials({
      name: "Account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;

        // Try DB first
        let databaseUnavailable = false;
        try {
          const pool = getDbPool();
          const result = await pool.query(
            "SELECT id, tenant_id, email, display_name, password_hash, status FROM studio_users WHERE email = $1",
            [email]
          );

          if (result.rows.length > 0) {
            const user = result.rows[0];

            if (user.status !== "active") return null;

            const isValid = await bcrypt.compare(password, user.password_hash);
            if (isValid) {
              return {
                id: user.id,
                tenantId: user.tenant_id,
                email: user.email,
                name: user.display_name ?? undefined,
              };
            }
            return null; // Invalid password
          }
        } catch (error) {
          databaseUnavailable = true;
          console.error("Database auth error:", error);
        }

        // Development fallback
        if (
          process.env.NODE_ENV !== "production" &&
          process.env.AUTH_DEV_ENABLED === "true" &&
          password === process.env.AUTH_DEV_PASSWORD
        ) {
          const userId = process.env.AUTH_DEV_USER_ID;
          const tenantId = process.env.AUTH_DEV_TENANT_ID;
          return userId && tenantId ? { id: userId, tenantId } : null;
        }

        // Avoid presenting DB outages as invalid credentials.
        if (databaseUnavailable) {
          throw new DatabaseUnavailableError();
        }

        return null;
      }
    })
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt: ({ token, user, trigger, session }) => {
      if (user) {
        token.tenantId = (user as { tenantId?: string }).tenantId ?? token.tenantId;
      }
      if (trigger === "update" && session && typeof session === "object" && "tenantId" in session) {
        const next = (session as { tenantId?: string | null }).tenantId;
        if (typeof next === "string" && next.trim()) {
          token.tenantId = next;
        } else if (next === null) {
          delete token.tenantId;
        }
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub as string,
        tenantId: token.tenantId as string | undefined,
      },
    }),
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export type AuthenticatedPrincipal = { userId: string; tenantId: string };

/** Session user id only (may have no organization yet after registration). */
export async function getSessionUserId(): Promise<string | null> {
  const user = (await auth())?.user as { id?: string } | undefined;
  return user?.id ?? null;
}

export async function getAuthenticatedPrincipal(): Promise<AuthenticatedPrincipal | null> {
  const user = (await auth())?.user as { id?: string; tenantId?: string | null } | undefined;
  if (!user?.id) return null;
  if (user.tenantId) return { userId: user.id, tenantId: user.tenantId };

  // Refresh last-organization pointer from DB (set after org create / seed).
  try {
    const pool = getDbPool();
    const result = await pool.query("SELECT tenant_id FROM studio_users WHERE id = $1", [user.id]);
    const tenantId = result.rows[0]?.tenant_id as string | null | undefined;
    if (tenantId) return { userId: user.id, tenantId };
  } catch {
    /* fall through */
  }
  return null;
}
