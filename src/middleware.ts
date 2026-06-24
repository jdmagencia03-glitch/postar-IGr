import { NextRequest, NextResponse } from "next/server";
import { applyCorsHeaders, applySecurityHeaders } from "@/lib/security/headers";
import { resolveRateLimitPolicy } from "@/lib/security/rate-limit-config";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

/** Constante local — middleware Edge não importa helpers de sessão/Supabase. */
const SESSION_COOKIE = "insta_scheduler_session";

function withSecurityHeaders(response: NextResponse, request: NextRequest) {
  applySecurityHeaders(response);
  applyCorsHeaders(response, request.headers.get("origin"));
  return response;
}

function enforceApiRateLimit(request: NextRequest, pathname: string) {
  const policy = resolveRateLimitPolicy(pathname, request.method, request);
  if (policy.skip) return null;

  const ip = getClientIp(request);
  const result = checkRateLimit({
    key: `${policy.scope}:${ip}`,
    limit: policy.limit,
    windowMs: policy.windowMs,
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
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
