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
          const userId = process.env.AUTH_DEV_USER_ID ?? "dev-user";
          const tenantId = process.env.AUTH_DEV_TENANT_ID ?? "dev-org";
          try {
            const pool = getDbPool();
            await pool.query(
              `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status)
               VALUES ($1, $2, $3, $4, NULL, 'active')
               ON CONFLICT (id) DO UPDATE SET status = 'active'`,
              [userId, email, "", "Dev User"],
            );
          } catch (e) {
            console.error("Failed to seed dev user into studio_users:", e);
          }
          return { id: userId, tenantId };
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
  if (!user?.id) return null;
  try {
    const pool = getDbPool();
    const result = await pool.query(
      "SELECT id FROM studio_users WHERE id = $1 AND status = 'active'",
      [user.id],
    );
    if (result.rows.length > 0) return user.id;

    // In development, auto-seed dev-user if logged in via dev fallback
    if (
      process.env.NODE_ENV !== "production" &&
      (user.id === "dev-user" || user.id === process.env.AUTH_DEV_USER_ID)
    ) {
      await pool.query(
        `INSERT INTO studio_users (id, email, password_hash, display_name, tenant_id, status)
         VALUES ($1, $2, $3, $4, NULL, 'active')
         ON CONFLICT (id) DO UPDATE SET status = 'active'`,
        [user.id, "dev@localhost", "", "Dev User"],
      );
      return user.id;
    }

    return null;
  } catch {
    return user.id;
  }
}

export async function getAuthenticatedPrincipal(request?: Request): Promise<AuthenticatedPrincipal | null> {
  const user = (await auth())?.user as { id?: string; tenantId?: string | null } | undefined;
  if (!user?.id) return null;
  const scoped = request && new URL(request.url).pathname.match(/^\/api\/o\/([^/]+)\//);
  if (scoped) {
    const slug = decodeURIComponent(scoped[1]);
    const result = await getDbPool().query(
      `SELECT o.id FROM studio_organizations o
       JOIN studio_organization_memberships m ON m.organization_id = o.id
       JOIN studio_users u ON u.id = m.user_id
       WHERE o.slug = $1 AND m.user_id = $2 AND m.status = 'active'
         AND o.status = 'active' AND u.status = 'active' LIMIT 1`,
      [slug, user.id],
    );
    if (!result.rows[0]) return null;
    return { userId: user.id, tenantId: String(result.rows[0].id) };
  }
  // The session value is a last-org hint. Verify it before signing legacy BFF calls too.
  try {
    const result = await getDbPool().query(
      `SELECT o.id FROM studio_users u
       JOIN studio_organization_memberships m ON m.user_id = u.id
         AND m.organization_id = COALESCE($1::text, u.tenant_id)
       JOIN studio_organizations o ON o.id = m.organization_id
       WHERE u.id = $2 AND u.status = 'active' AND m.status = 'active'
         AND o.status = 'active' LIMIT 1`,
      [user.tenantId ?? null, user.id],
    );
    if (result.rows[0]) return { userId: user.id, tenantId: String(result.rows[0].id) };
  } catch {
    /* fail closed */
  }
  return null;
}
