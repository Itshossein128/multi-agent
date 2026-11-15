import { signOut } from "@/auth";

/** Clears the Auth.js session cookie; usable via redirect from Server Components. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const callbackUrl = url.searchParams.get("callbackUrl");
  const redirectTo =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/login";
  await signOut({ redirectTo });
}
