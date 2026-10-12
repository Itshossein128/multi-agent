/** Client module for current organization slug (set by org layout). */

let currentOrgSlug: string | null = null;

export function setCurrentOrgSlug(slug: string | null): void {
  currentOrgSlug = slug && slug.trim() ? slug.trim().toLowerCase() : null;
}

export function getCurrentOrgSlug(): string | null {
  if (typeof window !== "undefined") {
    const match = window.location.pathname.match(/^\/o\/([^/]+)(?:\/|$)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
  return currentOrgSlug;
}

export function executionApiBase(slug = getCurrentOrgSlug()): string {
  if (slug) return `/api/o/${encodeURIComponent(slug)}/execution`;
  return "/api/execution";
}

export function orgPath(slug: string, path = ""): string {
  const normalized = path.startsWith("/") ? path : path ? `/${path}` : "";
  return `/o/${encodeURIComponent(slug)}${normalized}`;
}

/** Preserve the organization selected in this tab for every local BFF request. */
export function scopedApiPath(path: string): string {
  const slug = getCurrentOrgSlug();
  return slug ? `/api/o/${encodeURIComponent(slug)}${path.slice(4)}` : path;
}
