import { getAppUrl } from "@/lib/app-url";

function getFacebookCredentials() {
  const appId = process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("META_APP_ID e META_APP_SECRET não configurados");
  }

  return { appId, appSecret };
}

function getRedirectUri() {
  return `${getAppUrl()}/api/auth/facebook/callback`;
}

const FACEBOOK_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
  "pages_messaging",
  "pages_manage_metadata",
  "business_management",
].join(",");

async function requestFacebookAccessToken(params: URLSearchParams) {
  const getRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params}`);
  const getData = await getRes.json();

  if (getRes.ok && getData.access_token) {
    return getData.access_token as string;
  }

  const postRes = await fetch("https://graph.facebook.com/v21.0/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const postData = await postRes.json();

  if (!postRes.ok || !postData.access_token) {
    throw new Error(postData.error?.message ?? getData.error?.message ?? "Falha na API do Facebook");
  }

  return postData.access_token as string;
}

export function isFacebookOAuthConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function getFacebookAuthUrl(state: string, options?: { forceReauth?: boolean }) {
  const { appId } = getFacebookCredentials();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getRedirectUri(),
    scope: FACEBOOK_SCOPES,
    response_type: "code",
    state,
  });

  if (options?.forceReauth) {
    params.set("auth_type", "rerequest");
  }

  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeFacebookCode(code: string) {
  const { appId, appSecret } = getFacebookCredentials();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: getRedirectUri(),
    code,
  });

  return requestFacebookAccessToken(params);
}

export async function getLongLivedFacebookToken(shortToken: string) {
  const { appId, appSecret } = getFacebookCredentials();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });

  return requestFacebookAccessToken(params);
}

export interface FacebookInstagramAccount {
  ig_user_id: string;
  ig_username: string;
  page_id: string;
  page_access_token: string;
  profile_picture_url: string | null;
}

export async function discoverInstagramAccountsFromFacebook(
  userToken: string,
): Promise<FacebookInstagramAccount[]> {
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${userToken}`,
  );
  const pagesData = await pagesRes.json();

  if (!pagesRes.ok) {
    throw new Error(pagesData.error?.message ?? "Falha ao listar páginas do Facebook");
  }

  const pages = (pagesData.data ?? []) as Array<{
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id: string };
  }>;

  const accounts: FacebookInstagramAccount[] = [];

  for (const page of pages) {
    const igBusinessId = page.instagram_business_account?.id;
    if (!igBusinessId || !page.access_token) continue;

    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${igBusinessId}?fields=id,username,profile_picture_url&access_token=${page.access_token}`,
    );
    const igData = await igRes.json();

    if (!igRes.ok || !igData.id) continue;

    accounts.push({
      ig_user_id: String(igData.id),
      ig_username: igData.username ?? page.name,
      page_id: page.id,
      page_access_token: page.access_token,
      profile_picture_url: igData.profile_picture_url ?? null,
    });
  }

  if (!accounts.length) {
    throw new Error(
      "Nenhuma conta Instagram Business vinculada a uma Página do Facebook foi encontrada.",
    );
  }

  return accounts;
}
