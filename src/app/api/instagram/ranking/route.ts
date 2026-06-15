import { NextRequest, NextResponse } from "next/server";
import { getOwnerAccounts } from "@/lib/accounts";
import {
  buildAccountsRanking,
  type RankingMetric,
  type RankingPeriod,
} from "@/lib/account-ranking";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function parseMetric(value: string | null): RankingMetric {
  if (value === "views" || value === "likes") return value;
  return "followers";
}

function parsePeriod(value: string | null): RankingPeriod {
  return value === "last_7_days" ? "last_7_days" : "today";
}

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const metric = parseMetric(request.nextUrl.searchParams.get("metric"));
  const period = parsePeriod(request.nextUrl.searchParams.get("period"));

  const supabase = createAdminClient();
  const accounts = await getOwnerAccounts(supabase, ownerId);

  if (!accounts.length) {
    return NextResponse.json({
      metric,
      period,
      top10: [],
      all_accounts: [],
      fetched_at: new Date().toISOString(),
      data_source: "instagram_api",
      message: "Nenhuma conta conectada",
    });
  }

  try {
    const ranking = await buildAccountsRanking({
      supabase,
      accounts,
      metric,
      period,
    });

    return NextResponse.json(ranking);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar ranking";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
