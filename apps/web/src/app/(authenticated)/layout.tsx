import React from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OrganizationGate } from "@/components/layout/OrganizationGate";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <OrganizationGate>{children}</OrganizationGate>
    </AppShell>
  );
}
