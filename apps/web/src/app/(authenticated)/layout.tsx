import React from "react";
import { redirect } from "next/navigation";
import { auth, getSessionUserId } from "@/auth";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const jwtUserId = (session?.user as { id?: string } | undefined)?.id;
  if (!jwtUserId) redirect("/login");

  // Stale JWT (account missing/inactive): clear cookie via Route Handler, then login.
  // Without this, edge proxy still treats the JWT as logged-in and /login ↔ / loops.
  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/logout?callbackUrl=%2Flogin");
  }

  return <>{children}</>;
}
