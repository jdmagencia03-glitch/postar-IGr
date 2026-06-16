import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, USER_ID_HEADER, lookupSessionToken } from "@/lib/auth/session-core";
import { applyCorsHeaders, applySecurityHeaders } from "@/lib/security/headers";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

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

function withSecurityHeaders(response: NextResponse, request: NextRequest) {
  applySecurityHeaders(response);
  applyCorsHeaders(response, request.headers.get("origin"));
  return response;
}

async function resolveUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  if (/^[a-f0-9]{64}$/i.test(token)) {
    return lookupSessionToken(token);
  }

  return null;
}

function enforceApiRateLimit(request: NextRequest, pathname: string) {
  const ip = getClientIp(request);
  const scope = pathname.startsWith("/api/upload") ? "upload" : "api";
  const limit = pathname.startsWith("/api/upload") ? 120 : 180;
  const result = checkRateLimit({
    key: `${scope}:${ip}`,
    limit,
    windowMs: 60_000,
  });

  if (!result.allowed) {
    return NextResponse.json(
      { error: "Muitas requisições. Tente novamente em instantes." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) },
      },
    );
  }

  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    return withSecurityHeaders(new NextResponse(null, { status: 204 }), request);
  }

  if (!isProtectedPath(pathname)) {
    return withSecurityHeaders(NextResponse.next(), request);
  }

  if (pathname.startsWith("/api/")) {
    const rateLimited = enforceApiRateLimit(request, pathname);
    if (rateLimited) {
      return withSecurityHeaders(rateLimited, request);
    }
  }

  const userId = await resolveUserIdFromRequest(request);

  if (!userId) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Não autenticado" }, { status: 401 }),
        request,
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl), request);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(USER_ID_HEADER, userId);

  return withSecurityHeaders(
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
    request,
  );
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
