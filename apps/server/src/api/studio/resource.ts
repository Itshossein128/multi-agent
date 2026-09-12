import { ApiError } from "../shared/http";

export function requireResource<T>(value: T | null | undefined, name: string): T {
  if (!value) throw new ApiError(404, `${name} not found`);
  return value;
}
