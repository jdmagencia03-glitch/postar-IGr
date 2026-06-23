export function getAppUrl() {
  const url =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "");
  if (url) return url;
  return "http://localhost:3000";
}

/** Sempre alinha com o redirect cadastrado no Meta Developer. */
export function getMetaRedirectUri() {
  return `${getAppUrl()}/api/auth/meta/callback`;
}
