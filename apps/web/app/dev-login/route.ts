import { SESSION_COOKIE } from "@duoshop/types";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { sessionCookie } from "../../lib/session";

// DEV UNIQUEMENT : pose un jeton émis par `pnpm dev:session` ; remplacé par le retour OIDC.
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production")
    return new NextResponse(null, { status: 404 });
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const store = request.nextUrl.searchParams.get("store") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(store))
    return new NextResponse(null, { status: 400 });
  (await cookies()).set(SESSION_COOKIE, token, {
    ...sessionCookie,
    maxAge: 12 * 3600,
  });
  return NextResponse.redirect(
    new URL(`/fr/account/stores/${store}`, request.url),
  );
}
