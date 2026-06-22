import { buildWarmupSchedulePlan, formatWarmupTimeSlot } from "../src/lib/account-warmup.ts";
import { getAppDateParts, zonedDateTimeToUtc } from "../src/lib/timezone.ts";

function formatSlot(date: Date) {
  const parts = getAppDateParts(date);
  return `${String(parts.year)}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${formatWarmupTimeSlot({ hour: parts.hour, minute: parts.minute })}`;
}

function assertPlan(
  name: string,
  now: Date,
  count: number,
  expected: string[],
  existingValidPostsByLocalDate?: Record<string, number>,
) {
  const plan = buildWarmupSchedulePlan({
    count,
    now,
    existingValidPostsByLocalDate,
  });
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
  if (plan.planningMeta) {
    console.log(
      `  Meta: existingToday=${plan.planningMeta.existingValidPostsToday} remainingToday=${plan.planningMeta.remainingSlotsToday}`,
    );
  }
  if (!pass) process.exitCode = 1;
}

const june22_1102 = zonedDateTimeToUtc(2026, 6, 22, 11, 2);
const june22_0700 = zonedDateTimeToUtc(2026, 6, 22, 7, 0);
const june22_2200 = zonedDateTimeToUtc(2026, 6, 22, 22, 0);
const day22 = "2026-06-22";

assertPlan("Teste 1 — 22/06 11:02 · 4 vídeos · 0 hoje", june22_1102, 4, [
  "2026-06-22 14:30",
  "2026-06-22 21:00",
  "2026-06-23 08:30",
  "2026-06-23 14:30",
]);

assertPlan(
  "Teste 2 — 22/06 11:02 · 4 vídeos · 1 hoje",
  june22_1102,
  4,
  ["2026-06-22 14:30", "2026-06-22 21:00", "2026-06-23 08:30", "2026-06-23 14:30"],
  { [day22]: 1 },
);

assertPlan(
  "Teste 3 — 22/06 11:02 · 4 vídeos · 2 hoje",
  june22_1102,
  4,
  ["2026-06-22 21:00", "2026-06-23 08:30", "2026-06-23 14:30", "2026-06-23 21:00"],
  { [day22]: 2 },
);

assertPlan(
  "Teste 4 — 22/06 11:02 · 4 vídeos · 3 hoje",
  june22_1102,
  4,
  ["2026-06-23 08:30", "2026-06-23 14:30", "2026-06-23 21:00", "2026-06-24 08:00"],
  { [day22]: 3 },
);

assertPlan("Teste 5 — 22/06 07:00 · 3 vídeos", june22_0700, 3, [
  "2026-06-22 08:30",
  "2026-06-22 14:30",
  "2026-06-22 21:00",
]);

assertPlan("Teste 6 — 22/06 22:00 · 4 vídeos", june22_2200, 4, [
  "2026-06-23 08:30",
  "2026-06-23 14:30",
  "2026-06-23 21:00",
  "2026-06-24 08:00",
]);

const june22_1627 = zonedDateTimeToUtc(2026, 6, 22, 16, 27);
const day23 = "2026-06-23";

assertPlan(
  "Teste 7 — 22/06 16:27 · 3 válidos hoje · início 23/06",
  june22_1627,
  4,
  ["2026-06-23 08:30", "2026-06-23 14:30", "2026-06-23 21:00", "2026-06-24 08:00"],
  { [day22]: 3 },
);

assertPlan(
  "Teste 8 — 22/06 16:27 · 2 válidos hoje · slot 21:00 hoje",
  june22_1627,
  4,
  ["2026-06-22 21:00", "2026-06-23 08:30", "2026-06-23 14:30", "2026-06-23 21:00"],
  { [day22]: 2 },
);

assertPlan(
  "Teste 9 — cancelados não ocupam (0 válidos mesmo com chave ausente)",
  june22_1627,
  3,
  ["2026-06-22 21:00", "2026-06-23 08:30", "2026-06-23 14:30"],
  {},
);

console.log(process.exitCode === 1 ? "\nFalhou." : "\nTodos os testes passaram.");
