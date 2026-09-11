import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getDbPool } from "@/lib/db";

import type { NextAuthConfig } from "next-auth";

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
        try {
          const pool = getDbPool();
          const result = await pool.query(
            "SELECT id, tenant_id, password_hash, status FROM studio_users WHERE email = $1",
            [email]
          );

          if (result.rows.length > 0) {
            const user = result.rows[0];

            if (user.status !== "active") return null;

            const isValid = await bcrypt.compare(password, user.password_hash);
            if (isValid) {
              return { id: user.id, tenantId: user.tenant_id };
            }
            return null; // Invalid password
          }
        } catch (error) {
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

        return null;
      }
    })
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt: ({ token, user }) => ({
      ...token,
      tenantId: (user as { tenantId?: string } | undefined)?.tenantId ?? token.tenantId
    }),
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub as string,
        tenantId: token.tenantId as string
      }
    })
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export type AuthenticatedPrincipal = { userId: string; tenantId: string };

export async function getAuthenticatedPrincipal(): Promise<AuthenticatedPrincipal | null> {
  const user = (await auth())?.user as { id?: string; tenantId?: string } | undefined;
  return user?.id && user.tenantId ? { userId: user.id, tenantId: user.tenantId } : null;
}
