"use client";

import { useEffect, useRef } from "react";
import { uploadSessionStore } from "@/lib/upload/session-store";

export function UploadSessionFileInputs() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const retryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    uploadSessionStore.registerFileInputs({
      pickFiles: () => fileInputRef.current?.click(),
      pickResume: () => resumeInputRef.current?.click(),
      pickRetry: () => retryInputRef.current?.click(),
    });
    return () => uploadSessionStore.registerFileInputs(null);
  }, []);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          uploadSessionStore.handleFileSelection(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={resumeInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadSessionStore.handleResume(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={retryInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm"
        className="hidden"
        onChange={(e) => {
          void uploadSessionStore.handleRetrySelection(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}
