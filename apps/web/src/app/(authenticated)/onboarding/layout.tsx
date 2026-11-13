import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { findActiveOrganization } from "@/lib/activeOrganization";
import { orgPath } from "@/lib/orgRoute";

/** Onboarding is account-scoped (no org shell) and only for signed-in accounts with no organization. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login?callbackUrl=%2Fonboarding%2Forganization");

  const organization = await findActiveOrganization(userId);
  if (organization) redirect(orgPath(organization.slug, "/"));

  return <div className="appearance-locked min-h-screen bg-zinc-950 text-zinc-100">{children}</div>;
}
