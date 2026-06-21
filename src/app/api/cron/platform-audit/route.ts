import { NextRequest, NextResponse } from "next/server";

/** @deprecated Use GET /api/admin/audit/cron?tier=critical|schedule */
export async function GET(request: NextRequest) {
  const tier = request.nextUrl.searchParams.get("tier") ?? "critical";
  const target = new URL(`/api/admin/audit/cron?tier=${tier}`, request.url);

  return NextResponse.json(
    {
      ok: false,
      deprecated: true,
      message: "Use GET /api/admin/audit/cron?tier=critical ou tier=schedule",
      redirectTo: target.pathname + target.search,
    },
    {
      status: 410,
      headers: {
        Link: `<${target.toString()}>; rel="successor-version"`,
      },
    },
  );
}
