"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { UploadEngineProgress } from "@/lib/upload/engine";

interface UploadContextValue {
  isActive: boolean;
  setIsActive: (active: boolean) => void;
  batchNumber: number | null;
  setBatchNumber: (value: number | null) => void;
  setProgress: (progress: UploadEngineProgress | null) => void;
  subscribeProgress: (listener: () => void) => () => void;
  getProgressSnapshot: () => UploadEngineProgress | null;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [batchNumber, setBatchNumber] = useState<number | null>(null);
  const progressRef = useRef<UploadEngineProgress | null>(null);
  const listenersRef = useRef(new Set<() => void>());

  const subscribeProgress = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getProgressSnapshot = useCallback(() => progressRef.current, []);

  const setProgress = useCallback((progress: UploadEngineProgress | null) => {
    progressRef.current = progress;
    for (const listener of listenersRef.current) {
      listener();
    }
  }, []);

  const value = useMemo(
    () => ({
      isActive,
      setIsActive,
      batchNumber,
      setBatchNumber,
      setProgress,
      subscribeProgress,
      getProgressSnapshot,
    }),
    [isActive, batchNumber, setProgress, subscribeProgress, getProgressSnapshot],
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

/** Assina progresso sem re-renderizar o restante da árvore (UploadProvider). */
export function useUploadProgress() {
  const context = useContext(UploadContext);
  return useSyncExternalStore(
    context?.subscribeProgress ?? (() => () => undefined),
    context?.getProgressSnapshot ?? (() => null),
    () => null,
  );
}
