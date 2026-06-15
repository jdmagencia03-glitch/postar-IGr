/**
 * Configura o job de publicação no cron-job.org via API.
 *
 * Uso:
 *   1. Crie conta em https://cron-job.org
 *   2. Vá em Settings → API Key → copie a chave
 *   3. Rode:
 *      CRON_JOB_ORG_API_KEY=sua-chave node scripts/setup-cron.mjs
 */

const API_KEY = process.env.CRON_JOB_ORG_API_KEY;
const PUBLISH_URL =
  process.env.PUBLISH_URL || "https://postarigr.vercel.app/api/cron/publish";
const CRON_SECRET = process.env.CRON_SECRET || "insta-scheduler-cron-7f3k9m2p";

if (!API_KEY) {
  console.error(`
❌ Falta a API key do cron-job.org.

Passos:
  1. Acesse https://console.cron-job.org/settings
  2. Gere/copie sua API Key
  3. Rode:

     CRON_JOB_ORG_API_KEY=SUA_CHAVE node scripts/setup-cron.mjs
`);
  process.exit(1);
}

const payload = {
  job: {
    title: "PostarIGr - publicar posts",
    url: PUBLISH_URL,
    enabled: true,
    saveResponses: true,
    requestMethod: 0,
    requestTimeout: 300,
    schedule: {
      timezone: "America/Sao_Paulo",
      expiresAt: 0,
      hours: [-1],
      mdays: [-1],
      minutes: [-1],
      months: [-1],
      wdays: [-1],
    },
    extendedData: {
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
    },
  },
};

const res = await fetch("https://api.cron-job.org/jobs", {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const data = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error("❌ Erro ao criar job:", res.status, data);
  process.exit(1);
}

console.log("✅ Cron criado com sucesso!");
console.log(`   Job ID: ${data.jobId}`);
console.log(`   URL: ${PUBLISH_URL}`);
console.log("   Intervalo: a cada 1 minuto");
console.log("\nPróximo passo: agende 1 vídeo de teste no app.");
