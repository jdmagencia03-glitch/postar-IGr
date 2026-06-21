const url = process.argv[2] ?? "https://postarigr.vercel.app/api/admin/audit/cron?tier=critical";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET missing");
  process.exit(1);
}
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await res.text();
console.log(`HTTP/${res.status} ${res.statusText}`);
console.log(body);
