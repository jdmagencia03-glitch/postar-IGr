import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("url from env:", url ? `${url.slice(0, 30)}...` : "MISSING");
console.log("key from env:", key ? "set" : "MISSING");

if (!url || !key) process.exit(1);

const sb = createClient(url, key);

const { data, error } = await sb
  .from("instagram_accounts")
  .select("owner_id,username")
  .ilike("username", "%deolhonoshape%");

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
