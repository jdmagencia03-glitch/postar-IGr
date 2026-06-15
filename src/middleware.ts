import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, USER_ID_HEADER, lookupSessionToken } from "@/lib/auth/session-core";

const PROTECTED_PAGES = ["/dashboard"];
const PROTECTED_APIS = [
  "/api/accounts",
  "/api/posts",
  "/api/upload",
  "/api/logs",
  "/api/captions",
  "/api/instagram",
  "/api/ai",
];

function isProtectedPath(pathname: string) {
  return (
    PROTECTED_PAGES.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    PROTECTED_APIS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

async function resolveUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  if (/^[a-f0-9]{64}$/i.test(token)) {
    return lookupSessionToken(token);
  }

  if (/^\d+$/.test(token)) return token;

  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const userId = await resolveUserIdFromRequest(request);

  if (!userId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(USER_ID_HEADER, userId);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/accounts/:path*",
    "/api/posts/:path*",
    "/api/upload/:path*",
    "/api/logs/:path*",
    "/api/captions/:path*",
    "/api/instagram/:path*",
    "/api/ai/:path*",
  ],
};
