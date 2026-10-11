"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  FolderKanban,
  LayoutDashboard,
  Network,
  Wallet,
  Webhook,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: "exact" | "prefix";
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, match: "exact" },
      { href: "/tasks", label: "Tasks", icon: Columns3 },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/workspaces", label: "Project workspaces", icon: Boxes },
    ],
  },
  {
    label: "Orchestration",
    items: [
      { href: "/org", label: "Org", icon: Workflow },
      { href: "/organization", label: "Goals", icon: Network },
      { href: "/routines", label: "Routines", icon: CalendarClock },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/budgets", label: "Budgets", icon: Wallet },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

type AppSidebarProps = {
  open: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export function AppSidebar({
  open,
  collapsed,
  onNavigate,
  onCollapsedChange,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile scrim */}
      <button
        type="button"
        aria-label="Close navigation"
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onNavigate}
      />

      <aside
        id="app-sidebar"
        aria-label="Primary"
        data-collapsed={collapsed || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-zinc-800/80 bg-zinc-950 transition-[transform,width] duration-200 ease-out lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed ? "w-60 lg:w-16" : "w-60",
        )}
      >
        <div className="flex h-16 shrink-0 items-center border-b border-zinc-800/80 px-4 lg:hidden">
          <span className="text-sm font-semibold tracking-tight text-white">
            Navigation
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 sticky top-0 max-h-screen">
          <div className={cn("space-y-6", collapsed && "lg:space-y-3")}>
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p
                  className={cn(
                    "mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500",
                    collapsed && "lg:sr-only",
                  )}
                >
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          title={item.label}
                          aria-label={item.label}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                            collapsed && "lg:justify-center lg:px-0",
                            active
                              ? "bg-zinc-800/80 font-medium text-white"
                              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4 shrink-0",
                              active ? "text-indigo-400" : "text-zinc-500",
                            )}
                            aria-hidden
                          />
                          <span className={cn(collapsed && "lg:hidden")}>
                            {item.label}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="hidden shrink-0 border-t border-zinc-800/80 p-2 lg:block">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onCollapsedChange?.(!collapsed)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={cn(
              "h-9 w-full gap-2 px-2.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <ChevronsLeft className="h-4 w-4" aria-hidden />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}
