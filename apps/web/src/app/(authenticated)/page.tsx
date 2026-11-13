import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { findActiveOrganization } from "@/lib/activeOrganization";
import { orgPath } from "@/lib/orgRoute";

const ONBOARDING = "/onboarding/organization";

export default async function AuthenticatedHomePage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login");

  const organization = await findActiveOrganization(userId);
  redirect(organization ? orgPath(organization.slug, "/") : ONBOARDING);
}
