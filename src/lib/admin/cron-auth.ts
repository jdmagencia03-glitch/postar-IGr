import { NextRequest } from "next/server";
import { getCronSecret } from "@/lib/security/secrets";

export function authorizeCronRequest(request: NextRequest) {
  const secret = getCronSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
