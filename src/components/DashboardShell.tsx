"use client";

import { AppShell } from "@/components/AppShell";
import { UploadSessionProvider } from "@/contexts/UploadSessionProvider";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <UploadSessionProvider>
      <AppShell>{children}</AppShell>
    </UploadSessionProvider>
  );
}
