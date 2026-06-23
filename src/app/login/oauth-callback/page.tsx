import { Suspense } from "react";
import { LoginOAuthCallback } from "@/components/LoginOAuthCallback";

export const dynamic = "force-dynamic";

export default function LoginOAuthCallbackPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
      <Suspense
        fallback={
          <p className="text-sm text-ig-muted">Conectando sua conta Instagram…</p>
        }
      >
        <LoginOAuthCallback />
      </Suspense>
    </main>
  );
}
