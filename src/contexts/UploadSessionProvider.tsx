"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { uploadSessionStore } from "@/lib/upload/session-store";
import { UploadGlobalBar } from "@/components/upload/UploadGlobalBar";
import { UploadSessionFileInputs } from "@/components/upload/UploadSessionFileInputs";

const UploadSessionContext = createContext<typeof uploadSessionStore | null>(null);

export function UploadSessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void uploadSessionStore.initialize();

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void uploadSessionStore.reconcileOnForeground();
      }
    };

    const onFocus = () => {
      void uploadSessionStore.reconcileOnForeground();
    };

    const reconcileTimer = window.setInterval(() => {
      if (document.hidden) return;
      const snapshot = uploadSessionStore.getSnapshot();
      if (snapshot.running || snapshot.retrying) {
        void uploadSessionStore.reconcileOnForeground();
      }
    }, 30_000);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(reconcileTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <UploadSessionContext.Provider value={uploadSessionStore}>
      {children}
      <UploadSessionFileInputs />
      <UploadGlobalBar />
    </UploadSessionContext.Provider>
  );
}

export function useUploadSessionStore() {
  const context = useContext(UploadSessionContext);
  if (!context) {
    throw new Error("useUploadSessionStore must be used within UploadSessionProvider");
  }
  return context;
}

export function useOptionalUploadSessionStore() {
  return useContext(UploadSessionContext);
}

/** Re-render when session store changes. */
export function useUploadSession() {
  const store = useUploadSessionStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useOptionalUploadSession() {
  const store = useOptionalUploadSessionStore();
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.getSnapshot ?? (() => null),
    () => null,
  );
}
