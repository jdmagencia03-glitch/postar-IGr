"use client";

import { AppShell } from "@/components/AppShell";
import { ApiStabilityBanner } from "@/components/dashboard/ApiStabilityBanner";
import { UploadSessionProvider } from "@/contexts/UploadSessionProvider";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <UploadSessionProvider>
      <ApiStabilityBanner />
      <AppShell>{children}</AppShell>
    </UploadSessionProvider>
  );
}
