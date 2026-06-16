import { createAdminClient } from "@/lib/supabase/admin";

export type SecurityEventType =
  | "login_success"
  | "login_failed"
  | "access_denied"
  | "rate_limited"
  | "upload_prepared"
  | "upload_completed"
  | "post_scheduled"
  | "post_deleted"
  | "account_deleted"
  | "suspicious_access";

export async function logSecurityEvent(params: {
  ownerId?: string | null;
  eventType: SecurityEventType;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const supabase = createAdminClient();
    await supabase.from("security_audit_logs").insert({
      owner_id: params.ownerId ?? null,
      event_type: params.eventType,
      resource_type: params.resourceType ?? null,
      resource_id: params.resourceId ?? null,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Never break the request flow because of audit logging.
  }
}

export async function logAccessDenied(params: {
  ownerId?: string | null;
  resourceType: string;
  resourceId?: string;
  request?: Request;
  reason?: string;
}) {
  await logSecurityEvent({
    ownerId: params.ownerId,
    eventType: "access_denied",
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    ipAddress: params.request ? params.request.headers.get("x-forwarded-for") : null,
    userAgent: params.request ? params.request.headers.get("user-agent") : null,
    metadata: params.reason ? { reason: params.reason } : undefined,
  });
}
