"use client";

import { signOut } from "next-auth/react";
import { LogOut, User } from "lucide-react";
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
      className="h-8 gap-1.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800"
    >
      <LogOut className="h-3.5 w-3.5" />
      Sign Out
    </Button>
  );
}
