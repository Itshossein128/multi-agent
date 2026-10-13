import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Onboarding is account-scoped (no org shell), but requires an authenticated user. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=" + encodeURIComponent("/onboarding/organization"));
  }
  return <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>;
}
