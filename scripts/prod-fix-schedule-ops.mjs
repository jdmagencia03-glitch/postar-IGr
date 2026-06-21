const base = process.argv[2] ?? "https://postarigr.vercel.app";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET missing — use: npx vercel env run --environment production -- node scripts/prod-fix-schedule-ops.mjs");
  process.exit(1);
}

async function request(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const accounts = await request("/api/admin/fix-schedule-times/accounts");
console.log("=== ACCOUNTS ===");
console.log(JSON.stringify(accounts, null, 2));

const ig = accounts.json?.instagram?.find((a) =>
  a.handle.toLowerCase().includes("deolhonoshape3s"),
);
const tt = accounts.json?.tiktok?.find((a) =>
  a.handle.toLowerCase().includes("paporetootv"),
);

if (!tt?.accountId) {
  console.error("TikTok @paporetootv not found");
  process.exit(1);
}

const dryRun = await request("/api/admin/fix-schedule-times/dry-run", {
  platform: "tiktok",
  accountId: tt.accountId,
});
console.log("\n=== TIKTOK DRY-RUN ===");
console.log(JSON.stringify(dryRun, null, 2));

console.log("\n=== CONFIRMED UUIDs ===");
console.log(
  JSON.stringify(
    {
      instagram: ig ?? null,
      tiktok: tt ?? null,
    },
    null,
    2,
  ),
);
