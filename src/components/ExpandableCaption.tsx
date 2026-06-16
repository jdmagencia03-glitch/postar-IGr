"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  emptyLabel?: string;
  maxLines?: number;
  className?: string;
}

export function ExpandableCaption({
  text,
  emptyLabel = "(sem legenda)",
  maxLines = 4,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const content = text?.trim() || emptyLabel;
  const canExpand = useMemo(() => {
    if (!text?.trim()) return false;
    const lineCount = text.split("\n").length;
    return text.length > 140 || lineCount > maxLines;
  }, [text, maxLines]);

  return (
    <div className={className}>
      <p
        className={cn(
          "whitespace-pre-wrap text-sm text-ig-text",
          !expanded && canExpand && (maxLines === 2 ? "line-clamp-2" : "line-clamp-4"),
        )}
      >
        {content}
      </p>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs font-medium text-ig-primary hover:underline"
        >
          {expanded ? "Ver menos" : "Ler mais"}
        </button>
      )}
    </div>
  );
}
