import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");
  return <>{children}</>;
}
