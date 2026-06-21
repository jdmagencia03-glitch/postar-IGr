import { existsSync, readFileSync } from "fs";

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

loadEnv(".env.vercel.audit");
console.log("url set:", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL));
console.log("key set:", Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));
