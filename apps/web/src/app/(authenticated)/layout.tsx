import React from "react";
import { AppHeader } from "@/components/layout/AppHeader";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <AppHeader />
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
