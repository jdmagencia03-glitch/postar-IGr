"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { SocialPlatform } from "@/lib/types";

type Props = {
  platform: SocialPlatform;
  accountId: string;
  batchId?: string | null;
  onStartNewBatch: () => void;
  onViewDetails?: () => void;
  primaryLabel?: string;
};

export function BatchCompletionActions({
  platform,
  accountId,
  batchId,
  onStartNewBatch,
  onViewDetails,
  primaryLabel = "Enviar outro lote",
}: Props) {
  const calendarHref = useMemo(() => {
    const query = new URLSearchParams({ platform, account: accountId });
    return `/dashboard/calendar?${query.toString()}`;
  }, [platform, accountId]);

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="ig-btn px-4 py-2 text-sm font-semibold" onClick={onStartNewBatch}>
        {primaryLabel}
      </button>
      <Link href={calendarHref} className="ig-btn-secondary px-4 py-2 text-sm font-semibold">
        Abrir calendário
      </Link>
      {batchId ? (
        <Link href={`/dashboard/uploads/${batchId}`} className="ig-btn-secondary px-4 py-2 text-sm font-semibold">
          Ver detalhes
        </Link>
      ) : onViewDetails ? (
        <button
          type="button"
          className="ig-btn-secondary px-4 py-2 text-sm font-semibold"
          onClick={onViewDetails}
        >
          Ver detalhes
        </button>
      ) : null}
    </div>
  );
}
