"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StudioDashboardData, TimeFilter } from "@/lib/dashboard/types";
import { useStudioStore } from "@/store/useStudioStore";
import { useEffect } from "react";

async function fetchDashboardData(timeFilter: TimeFilter): Promise<StudioDashboardData> {
  const res = await fetch(`/api/dashboard?filter=${timeFilter}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch dashboard data: ${res.statusText}`);
  }
  return res.json();
}

export function useDashboardQuery() {
  const queryClient = useQueryClient();
  const { timeFilter, syncWithBackend } = useStudioStore();

  const query = useQuery({
    queryKey: ["dashboard", timeFilter],
    queryFn: () => fetchDashboardData(timeFilter),
    refetchInterval: 3000,
  });

  // Keep Zustand store in sync with live backend react-query state
  useEffect(() => {
    if (query.data) {
      syncWithBackend(query.data);
    }
  }, [query.data, syncWithBackend]);

  const retryMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", taskId }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", taskId }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const enqueueMutation = useMutation({
    mutationFn: async (data: { title: string; role: string; priority?: string }) => {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue", ...data }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return {
    ...query,
    retryTask: retryMutation.mutate,
    cancelTask: cancelMutation.mutate,
    enqueueTask: enqueueMutation.mutate,
    isMutating: retryMutation.isPending || cancelMutation.isPending || enqueueMutation.isPending,
  };
}
