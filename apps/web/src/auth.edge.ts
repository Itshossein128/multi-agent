/**
 * Edge-safe auth configuration.
 * This file must NOT import bcryptjs, pg, or any other Node.js-only module,
 * because it is used in Next.js Middleware which runs in the Edge Runtime.
 */
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";

export const authEdgeConfig: NextAuthConfig = {
  trustHost: true,
  providers: [], // No providers needed for edge – only JWT session validation
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt: ({ token, user }) => ({
      ...token,
      tenantId:
        (user as { tenantId?: string } | undefined)?.tenantId ??
        token.tenantId,
    }),
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub as string,
        tenantId: token.tenantId as string,
      },
    }),
  },
};

export const { auth } = NextAuth(authEdgeConfig);
