import { redirect } from "next/navigation";
import { ScheduleJobsOperationsPanel } from "@/components/operations/ScheduleJobsOperationsPanel";
import { getSessionUserId } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

export default async function ScheduleJobsOperationsPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/operations/schedule-jobs");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ScheduleJobsOperationsPanel />
    </div>
  );
}
