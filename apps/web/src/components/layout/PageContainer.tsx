import React from "react";
import { cn } from "@/lib/utils";

/**
 * Canonical centered page container inside AppShell so every route shares the
 * same max width (`max-w-6xl`), responsive inline gutters, and block rhythm.
 */
export const PAGE_CONTAINER_CLASS =
  "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6";

type PageContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
};

export function PageContainer({
  children,
  className,
  ...props
}: PageContainerProps) {
  return (
    <div className={cn(PAGE_CONTAINER_CLASS, "space-y-6", className)} {...props}>
      {children}
    </div>
  );
}
