import { createHmac, timingSafeEqual } from "crypto";
import { getSessionSecret } from "@/lib/security/secrets";

export function parseSignedSession(value: string): string | null {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const userId = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);
  if (!userId || !signature) return null;

  const expected = createHmac("sha256", getSessionSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 24);

  try {
    if (
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return userId;
    }
  } catch {
    return null;
  }

  return null;
}
