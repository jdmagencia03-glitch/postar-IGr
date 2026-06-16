export const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "off",
};

export function applySecurityHeaders(response: Response) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  return response;
}

export function getAllowedOrigin() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return appUrl || null;
}

export function applyCorsHeaders(response: Response, requestOrigin: string | null) {
  const allowedOrigin = getAllowedOrigin();
  if (!allowedOrigin || !requestOrigin || requestOrigin !== allowedOrigin) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Vary", "Origin");
  return response;
}
