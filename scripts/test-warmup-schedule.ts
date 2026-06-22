import { buildWarmupSchedulePlan, formatWarmupTimeSlot } from "../src/lib/account-warmup.ts";
import { getAppDateParts, zonedDateTimeToUtc } from "../src/lib/timezone.ts";

function formatSlot(date: Date) {
  const parts = getAppDateParts(date);
  return `${String(parts.year)}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute })}`;
}

function assertPlan(name: string, now: Date, count: number, expected: string[]) {
  const plan = buildWarmupSchedulePlan({ count, now });
  const actual = plan.schedule.map(formatSlot);
  const pass =
    actual.length === expected.length &&
    actual.every((slot, index) => slot === expected[index]);

  console.log(`\n${pass ? "✓" : "✗"} ${name}`);
  console.log(`  Esperado: ${expected.join(" | ")}`);
  console.log(`  Obtido:   ${actual.join(" | ")}`);
  if (plan.skippedPastSlots.length) {
    console.log(
      `  Ignorados: ${plan.skippedPastSlots.map((slot) => `${slot.time}`).join(", ")}`,
    );
  }
  if (!pass) process.exitCode = 1;
}

const june22_1102 = zonedDateTimeToUtc(2026, 6, 22, 11, 2);
const june22_0700 = zonedDateTimeToUtc(2026, 6, 22, 7, 0);
const june22_2200 = zonedDateTimeToUtc(2026, 6, 22, 22, 0);

assertPlan("Teste 1 — 22/06 11:02 · 4 vídeos", june22_1102, 4, [
  "2026-06-22 14:30",
  "2026-06-22 21:00",
  "2026-06-23 08:30",
  "2026-06-23 14:30",
]);

assertPlan("Teste 2 — 22/06 11:02 · 3 vídeos", june22_1102, 3, [
  "2026-06-22 14:30",
  "2026-06-22 21:00",
  "2026-06-23 08:30",
]);

assertPlan("Teste 3 — 22/06 07:00 · 3 vídeos", june22_0700, 3, [
  "2026-06-22 08:30",
  "2026-06-22 14:30",
  "2026-06-22 21:00",
]);

assertPlan("Teste 4 — 22/06 22:00 · 4 vídeos", june22_2200, 4, [
  "2026-06-23 08:30",
  "2026-06-23 14:30",
  "2026-06-23 21:00",
  "2026-06-24 08:00",
]);

console.log(process.exitCode === 1 ? "\nFalhou." : "\nTodos os testes passaram.");
