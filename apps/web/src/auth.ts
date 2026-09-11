import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, auth } = NextAuth({ trustHost: true, providers: [Credentials({ name: "Development identity", credentials: { password: { label: "Password", type: "password" } }, authorize(credentials) {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_DEV_ENABLED !== "true" || credentials?.password !== process.env.AUTH_DEV_PASSWORD) return null;
  const userId = process.env.AUTH_DEV_USER_ID, tenantId = process.env.AUTH_DEV_TENANT_ID;
  return userId && tenantId ? { id: userId, tenantId } : null;
} })], callbacks: { jwt: ({ token, user }) => ({ ...token, tenantId: (user as { tenantId?: string } | undefined)?.tenantId ?? token.tenantId }), session: ({ session, token }) => ({ ...session, user: { ...session.user, id: token.sub, tenantId: token.tenantId } }) } });

export type AuthenticatedPrincipal = { userId: string; tenantId: string };
export async function getAuthenticatedPrincipal(): Promise<AuthenticatedPrincipal | null> {
  const user = (await auth())?.user as { id?: string; tenantId?: string } | undefined;
  return user?.id && user.tenantId ? { userId: user.id, tenantId: user.tenantId } : null;
}
