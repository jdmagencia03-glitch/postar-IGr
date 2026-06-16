import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { logAccessDenied, logSecurityEvent } from "@/lib/security/audit";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

export async function requireAuthenticatedUser(request?: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    if (request) {
      await logSecurityEvent({
        eventType: "access_denied",
        ipAddress: getClientIp(request),
        userAgent: request.headers.get("user-agent"),
        metadata: { reason: "unauthenticated" },
      });
    }
    return null;
  }
  return userId;
}

export async function enforceRateLimit(params: {
  request: Request;
  userId?: string | null;
  scope: string;
  limit: number;
  windowMs: number;
}) {
  const ip = getClientIp(params.request);
  const ipResult = checkRateLimit({
    key: `${params.scope}:ip:${ip}`,
    limit: params.limit,
    windowMs: params.windowMs,
  });

  if (!ipResult.allowed) {
    await logSecurityEvent({
      ownerId: params.userId,
      eventType: "rate_limited",
      ipAddress: ip,
      metadata: { scope: params.scope, by: "ip" },
    });
    return NextResponse.json(
      { error: "Muitas requisições. Tente novamente em instantes." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(ipResult.retryAfterMs / 1000)) },
      },
    );
  }

  if (params.userId) {
    const userResult = checkRateLimit({
      key: `${params.scope}:user:${params.userId}`,
      limit: params.limit * 2,
      windowMs: params.windowMs,
    });

    if (!userResult.allowed) {
      await logSecurityEvent({
        ownerId: params.userId,
        eventType: "rate_limited",
        ipAddress: ip,
        metadata: { scope: params.scope, by: "user" },
      });
      return NextResponse.json(
        { error: "Muitas requisições. Tente novamente em instantes." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(userResult.retryAfterMs / 1000)) },
        },
      );
    }
  }

  return null;
}

export async function denyUnlessOwner(params: {
  ownerId: string;
  resourceType: string;
  resourceId?: string;
  request: Request;
  allowed: boolean;
}) {
  if (params.allowed) return null;

  await logAccessDenied({
    ownerId: params.ownerId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    request: params.request,
    reason: "ownership_mismatch",
  });

  return NextResponse.json({ error: "Recurso não encontrado" }, { status: 404 });
}
