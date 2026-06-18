import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { validateAccountPermissions } from "@/lib/operations/validate-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SocialPlatform } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const platform = (request.nextUrl.searchParams.get("platform") ?? "instagram") as SocialPlatform;
  const supabase = createAdminClient();

  try {
    const result = await validateAccountPermissions(supabase, ownerId, id, platform);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha na validação" },
      { status: 500 },
    );
  }
}
