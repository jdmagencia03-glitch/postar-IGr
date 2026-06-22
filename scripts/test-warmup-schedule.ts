import { buildWarmupSchedulePlan, formatWarmupTimeSlot } from "../src/lib/account-warmup.ts";
import { getAppDateParts, zonedDateTimeToUtc } from "../src/lib/timezone.ts";

function formatSlot(date: Date) {
  const parts = getAppDateParts(date);
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")} ${formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute })}`;
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

const june21_0700 = zonedDateTimeToUtc(2026, 6, 21, 7, 0);
const june21_1837 = zonedDateTimeToUtc(2026, 6, 21, 18, 37);
const june21_2200 = zonedDateTimeToUtc(2026, 6, 21, 22, 0);

assertPlan("Teste A — 07:00 · 3 vídeos", june21_0700, 3, [
  "21/06 08:30",
  "21/06 14:30",
  "21/06 21:00",
]);

assertPlan("Teste B — 18:37 · 3 vídeos", june21_1837, 3, [
  "21/06 21:00",
  "22/06 08:30",
  "22/06 14:30",
]);

assertPlan("Teste C — 22:00 · 3 vídeos", june21_2200, 3, [
  "22/06 08:30",
  "22/06 14:30",
  "22/06 21:00",
]);

assertPlan("Teste D — 18:37 · 6 vídeos", june21_1837, 6, [
  "21/06 21:00",
  "22/06 08:30",
  "22/06 14:30",
  "22/06 21:00",
  "23/06 08:00",
  "23/06 12:30",
]);

console.log(process.exitCode === 1 ? "\nFalhou." : "\nTodos os testes passaram.");
