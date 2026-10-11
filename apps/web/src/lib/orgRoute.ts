/** Client module for current organization slug (set by org layout). */

let currentOrgSlug: string | null = null;

export function setCurrentOrgSlug(slug: string | null): void {
  currentOrgSlug = slug && slug.trim() ? slug.trim().toLowerCase() : null;
}

export function getCurrentOrgSlug(): string | null {
  return currentOrgSlug;
}

export function executionApiBase(slug = currentOrgSlug): string {
  if (slug) return `/api/o/${encodeURIComponent(slug)}/execution`;
  return "/api/execution";
}

export function orgPath(slug: string, path = ""): string {
  const normalized = path.startsWith("/") ? path : path ? `/${path}` : "";
  return `/o/${encodeURIComponent(slug)}${normalized}`;
}
