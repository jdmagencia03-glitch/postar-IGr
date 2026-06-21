import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { scheduleInngestFunctions } from "@/lib/inngest/functions/schedule-jobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: scheduleInngestFunctions,
});
