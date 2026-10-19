export const APPEARANCE_STORAGE_KEY = "agent-studio.appearance.v1";

export type Appearance = "light" | "dark";

export function parseAppearance(value: string | null): Appearance {
  if (value === "light" || value === "dark") return value;
  return "dark";
}

export function toggleAppearance(current: Appearance): Appearance {
  return current === "dark" ? "light" : "dark";
}

export function readAppearance(storage: Pick<Storage, "getItem">): Appearance {
  try {
    return parseAppearance(storage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "dark";
  }
}

export function writeAppearance(storage: Pick<Storage, "setItem">, value: Appearance): void {
  if (value !== "light" && value !== "dark") return;
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    // Preference is best-effort UI state. A blocked store must not break the page.
  }
}
