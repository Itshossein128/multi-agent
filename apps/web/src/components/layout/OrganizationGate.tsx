"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const ONBOARDING_PATH = "/onboarding/organization";

type GateState = "loading" | "needs_org" | "ready" | "error";

export function OrganizationGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<GateState>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const onOnboarding = pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const res = await fetch("/api/organizations/current");
        if (cancelled) return;
        if (res.status === 404) {
          if (!onOnboarding) router.replace(ONBOARDING_PATH);
          setState("needs_org");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }
        if (onOnboarding) {
          router.replace("/projects");
        }
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onOnboarding, pathname, router, retryToken]);

  if (state === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-red-300">Unable to verify organization setup.</p>
        <button
          type="button"
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
          onClick={() => setRetryToken((n) => n + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  // Fail closed: only allow the onboarding route when no org exists.
  if (state === "needs_org") {
    if (!onOnboarding) {
      return (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-400">
          Redirecting to organization setup…
        </div>
      );
    }
    return <>{children}</>;
  }

  return <>{children}</>;
}
