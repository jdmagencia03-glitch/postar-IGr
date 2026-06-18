"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { SocialPlatform } from "@/lib/types";

interface Props {
  accountId: string;
  platform: SocialPlatform;
}

export function TestPublishButton({ accountId, platform }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function runTest(confirmReal = false) {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/operations/accounts/${accountId}/test-publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          test_type: platform === "tiktok" ? "tiktok_video" : "reel",
          confirm_real_publish: confirmReal,
        }),
      });
      const data = await res.json();
      setMessage(data.message ?? data.warning ?? data.validation?.summary ?? data.error);
    } catch {
      setMessage("Erro ao testar publicação");
    } finally {
      setLoading(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void runTest(false)}
          className="inline-flex items-center gap-2 rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary disabled:opacity-50"
        >
          <FlaskConical className="h-4 w-4" />
          {loading ? "Testando…" : "Testar permissões"}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => setConfirmOpen(true)}
          className="rounded-lg border border-ig-border px-3 py-1.5 text-xs font-medium hover:bg-ig-secondary disabled:opacity-50"
        >
          Teste real (beta)
        </button>
      </div>
      {message && <p className="text-xs text-ig-muted">{message}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title="Publicar conteúdo de teste?"
        description="Isso pode publicar um conteúdo de teste na conta. Por enquanto, apenas permissões serão validadas com confirmação."
        confirmLabel="Continuar"
        confirmTone="primary"
        loading={loading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => runTest(true)}
      />
    </div>
  );
}
