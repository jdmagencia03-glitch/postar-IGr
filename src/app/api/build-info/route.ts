import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      deployed_at: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
