"use client";

import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setCurrentOrgSlug } from "@/lib/orgRoute";

export type OrgInfo = {
  id: string;
  slug: string;
  name: string;
  role?: "owner" | "admin" | "member" | "viewer";
};

type OrgContextValue = {
  org: OrgInfo;
  organizations: OrgInfo[];
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({
  org,
  organizations,
  children,
}: {
  org: OrgInfo;
  organizations: OrgInfo[];
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    setCurrentOrgSlug(org.slug);
    return () => setCurrentOrgSlug(null);
  }, [org.slug]);

  useEffect(() => {
    // Hard-reset cached org-scoped queries when the active organization changes.
    void queryClient.resetQueries();
  }, [org.id, queryClient]);

  const value = useMemo(() => ({ org, organizations }), [org, organizations]);
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}

export function useOptionalOrg(): OrgContextValue | null {
  return useContext(OrgContext);
}

/** Use context for links so server rendering and hydration have identical URLs. */
export function useOrgPath(): (path: string) => string {
  const context = useOptionalOrg();
  return (path: string) => context ? `/o/${encodeURIComponent(context.org.slug)}${path}` : path;
}
