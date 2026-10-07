"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  CalendarClock,
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
  onNavigate?: () => void;
};

export function AppSidebar({ open, onNavigate }: AppSidebarProps) {
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
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-zinc-800/80 bg-zinc-950 transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center border-b border-zinc-800/80 px-4 lg:hidden">
          <span className="text-sm font-semibold tracking-tight text-white">
            Navigation
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-6">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
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
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </aside>
    </>
  );
}
