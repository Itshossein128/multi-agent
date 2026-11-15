import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { findActiveOrganization } from "@/lib/activeOrganization";
import { orgPath } from "@/lib/orgRoute";

const ONBOARDING = "/onboarding/organization";

/** `/o` without a slug — same destination as `/` (login / org home / onboarding). */
export default async function OrganizationIndexPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/login?callbackUrl=%2Fo");

  const organization = await findActiveOrganization(userId);
  redirect(organization ? orgPath(organization.slug, "/") : ONBOARDING);
}
