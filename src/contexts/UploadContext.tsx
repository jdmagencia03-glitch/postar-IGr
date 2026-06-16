"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { UploadEngineProgress } from "@/lib/upload/engine";

interface UploadContextValue {
  progress: UploadEngineProgress | null;
  setProgress: (progress: UploadEngineProgress | null) => void;
  isActive: boolean;
  setIsActive: (active: boolean) => void;
  batchNumber: number | null;
  setBatchNumber: (value: number | null) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<UploadEngineProgress | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [batchNumber, setBatchNumber] = useState<number | null>(null);

  const value = useMemo(
    () => ({ progress, setProgress, isActive, setIsActive, batchNumber, setBatchNumber }),
    [progress, isActive, batchNumber],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUploadContext() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUploadContext must be used within UploadProvider");
  }
  return context;
}

export function useOptionalUploadContext() {
  return useContext(UploadContext);
}
