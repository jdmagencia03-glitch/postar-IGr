import { existsSync, readFileSync } from "fs";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
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
}

for (const file of [
  ".env.local",
  ".env.local.production",
  ".env.vercel.check",
  ".env.vercel.prod",
  ".env.vercel.runtime",
  ".env.vercel.pull.prod",
]) {
  loadEnv(file);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(supabaseUrl, serviceKey);

const username = process.argv[2] ?? "arquivoscuriosos3s";
const captionNeedle = process.argv[3] ?? "árvores conversam";
const dryRun = process.argv.includes("--dry-run");

const { data: accounts, error: accountError } = await sb
  .from("instagram_accounts")
  .select("id, ig_username, owner_id")
  .ilike("ig_username", `%${username}%`);

if (accountError) {
  console.error(accountError);
  process.exit(1);
}

if (!accounts?.length) {
  console.error(`Conta não encontrada: ${username}`);
  process.exit(1);
}

const accountId = accounts[0].id;
console.log("account", accounts[0]);

const { data: posts, error: postsError } = await sb
  .from("scheduled_posts")
  .select("id, status, scheduled_at, caption, error_message, content_type, media_type, created_at")
  .eq("account_id", accountId)
  .ilike("caption", `%${captionNeedle}%`)
  .order("scheduled_at", { ascending: false })
  .limit(10);

if (postsError) {
  console.error(postsError);
  process.exit(1);
}

console.log("matches", posts);

if (!posts?.length) {
  console.log("Nenhum post encontrado com esse filtro.");
  process.exit(0);
}

const target = posts[0];
console.log("target", target);

if (dryRun) {
  console.log("dry-run: não apagou");
  process.exit(0);
}

const postId = target.id;

const { error: logsError } = await sb.from("publish_logs").delete().eq("post_id", postId);
if (logsError) console.warn("publish_logs delete warning:", logsError.message);

const { error: deleteError } = await sb.from("scheduled_posts").delete().eq("id", postId);
if (deleteError) {
  console.error("delete failed:", deleteError);
  process.exit(1);
}

console.log("deleted", postId);
