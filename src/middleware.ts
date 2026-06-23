import { NextRequest, NextResponse } from "next/server";
import { applyCorsHeaders, applySecurityHeaders } from "@/lib/security/headers";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

/** Constante local — middleware Edge não importa helpers de sessão/Supabase. */
const SESSION_COOKIE = "insta_scheduler_session";

function withSecurityHeaders(response: NextResponse, request: NextRequest) {
  applySecurityHeaders(response);
  applyCorsHeaders(response, request.headers.get("origin"));
  return response;
}

function enforceApiRateLimit(request: NextRequest, pathname: string) {
  const ip = getClientIp(request);

  if (
    request.method === "PATCH" &&
    /\/api\/upload\/batches\/[^/]+\/files\/[^/]+$/.test(pathname)
  ) {
    return null;
  }

  const scope = pathname.startsWith("/api/upload") ? "upload" : "api";
  const limit = pathname.startsWith("/api/upload") ? 600 : 180;
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

  if (pathname.startsWith("/api/")) {
    const rateLimited = enforceApiRateLimit(request, pathname);
    if (rateLimited) {
      return withSecurityHeaders(rateLimited, request);
    }
    return withSecurityHeaders(NextResponse.next(), request);
  }

  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("next", pathname);
      return withSecurityHeaders(NextResponse.redirect(loginUrl), request);
    }
  }

  return withSecurityHeaders(NextResponse.next(), request);
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
    "/api/tiktok/:path*",
    "/api/health/:path*",
    "/api/comment-dm/:path*",
    "/api/calendar/:path*",
    "/api/schedule-jobs/:path*",
    "/api/debug/:path*",
  ],
};
