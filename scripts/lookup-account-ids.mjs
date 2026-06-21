import { existsSync, readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (v && !process.env[m[1].trim()]) process.env[m[1].trim()] = v;
  }
}

for (const f of [".env.local", ".env.vercel.prod"]) {
  loadEnv(f);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const sb = createClient(url, key);

const [{ data: ig }, { data: tt }] = await Promise.all([
  sb
    .from("instagram_accounts")
    .select("id, ig_username, owner_id")
    .ilike("ig_username", "deolhonoshape3s"),
  sb
    .from("tiktok_accounts")
    .select("id, username, owner_id")
    .ilike("username", "paporetootv"),
]);

const igRow = ig?.[0];
const ttRow = tt?.[0];

console.log(
  JSON.stringify(
    {
      instagram: igRow
        ? {
            handle: `@${(igRow.ig_username ?? "").replace(/^@/, "")}`,
            accountId: igRow.id,
            platform: "instagram",
          }
        : null,
      tiktok: ttRow
        ? {
            handle: `@${(ttRow.username ?? "").replace(/^@/, "")}`,
            accountId: ttRow.id,
            platform: "tiktok",
          }
        : null,
    },
    null,
    2,
  ),
);
