"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export function UserMenu() {
  const queryClient = useQueryClient();

  const handleSignOut = async () => {
    // Clear the query cache to avoid leaking user-scoped data across sessions
    queryClient.clear();
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleSignOut}
      aria-label="Sign Out"
      title="Sign Out"
      className="h-8 gap-1.5 px-2 sm:px-2.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
    >
      <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">Sign Out</span>
    </Button>
  );
}
