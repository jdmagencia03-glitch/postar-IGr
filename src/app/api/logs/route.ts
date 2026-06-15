import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("user_id", userId);

  const accountIds = accounts?.map((a) => a.id) ?? [];

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("id")
    .in("account_id", accountIds);

  const postIds = posts?.map((p) => p.id) ?? [];

  const { data, error } = await supabase
    .from("publish_logs")
    .select("*, scheduled_posts(caption, media_type, scheduled_at)")
    .in("post_id", postIds)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
