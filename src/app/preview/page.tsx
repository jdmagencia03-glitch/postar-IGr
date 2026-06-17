import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
import { DashboardNextPostsPanel } from "@/components/dashboard/DashboardNextPostsPanel";
import { DashboardStatsRow } from "@/components/dashboard/DashboardStatsRow";
import { DashboardUploadCardPreview } from "@/components/dashboard/DashboardUploadCardPreview";
import { DashboardWelcomeBanner } from "@/components/dashboard/DashboardWelcomeBanner";
import { OnboardingSteps } from "@/components/OnboardingSteps";

export default function PreviewPage() {
  const stats = {
    pending: 0,
    published: 0,
    publishedLast7Days: 0,
    failed: 0,
  };

  return (
    <DashboardShell>
      <div className="mb-4 rounded-lg border border-ig-info-border bg-ig-info-bg px-4 py-2 text-sm text-ig-info-text">
        Modo preview — dados simulados ·{" "}
        <code className="rounded bg-ig-elevated px-1.5 py-0.5 text-xs">http://localhost:3000/preview</code>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 pb-4">
        <DashboardWelcomeBanner />

        <OnboardingSteps playbookReady={false} hasScheduledPosts={false} currentStep={1} />

        <DashboardStatsRow stats={stats} />

        <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
          <DashboardNextPostsPanel posts={[]} allPosts={[]} />
          <DashboardUploadCardPreview
            fileName="Trindade.mp4"
            fileSize="2.06 GB"
            percent={75}
            completedCount={3}
            totalCount={4}
            batchNumber={12}
          />
        </div>
      </div>

      <p className="mt-8 text-center text-sm text-ig-muted">
        <Link href="/login" className="text-ig-primary hover:underline">
          Ir para login
        </Link>
        {" · "}
        <Link href="/dashboard" className="text-ig-primary hover:underline">
          Dashboard real
        </Link>
      </p>
    </DashboardShell>
  );
}
