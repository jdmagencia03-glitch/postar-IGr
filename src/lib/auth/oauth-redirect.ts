import { NextResponse } from "next/server";

/** Redirect via HTML — navegadores embutidos (AdsPower etc.) às vezes ignoram 307. */
export function oauthRedirectResponse(
  targetUrl: string,
  applyCookies?: (response: NextResponse) => void,
  message = "Entrando…",
) {
  const safeUrl = targetUrl.replace(/"/g, "&quot;");
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0;url=${safeUrl}" />
  <title>${message}</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    p{font-size:14px;opacity:.85}
  </style>
  <script>location.replace(${JSON.stringify(targetUrl)});</script>
</head>
<body><p>${message}</p></body>
</html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  applyCookies?.(response);
  return response;
}
