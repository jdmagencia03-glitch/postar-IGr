"use client";

import { Film, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isVideoPost, videoPreviewSrc } from "@/lib/media-preview";
import type { MediaType } from "@/lib/types";

type PreviewState = "idle" | "loading" | "ready" | "error";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ig-secondary text-ig-muted">
      <Film size={28} strokeWidth={1.5} />
      <span className="px-3 text-center text-[11px] font-medium">{label}</span>
    </div>
  );
}

function captureVideoFrame(video: HTMLVideoElement) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function MediaPreview({
  mediaType,
  mediaUrl,
  className = "h-full w-full object-cover",
}: {
  mediaType: MediaType;
  mediaUrl?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<PreviewState>("idle");
  const [poster, setPoster] = useState<string | null>(null);

  const isVideo = isVideoPost(mediaType, mediaUrl);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !mediaUrl) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [mediaUrl]);

  useEffect(() => {
    if (!visible || !mediaUrl || !isVideo) {
      return;
    }

    let cancelled = false;
    setState("loading");
    setPoster(null);

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = videoPreviewSrc(mediaUrl);

    const fail = () => {
      if (!cancelled) {
        setState("error");
      }
    };

    const onLoadedData = () => {
      video.currentTime = 0.1;
    };

    const onSeeked = () => {
      if (cancelled) {
        return;
      }

      const frame = captureVideoFrame(video);
      if (frame) {
        setPoster(frame);
        setState("ready");
      } else {
        fail();
      }
    };

    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", fail);

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", fail);
      video.removeAttribute("src");
      video.load();
    };
  }, [visible, mediaUrl, isVideo]);

  if (!mediaUrl) {
    return <Placeholder label="Sem mídia" />;
  }

  if (!isVideo) {
    return (
      <div ref={containerRef} className="h-full w-full">
        {visible ? (
          <img src={mediaUrl} alt="" className={className} loading="lazy" />
        ) : (
          <Placeholder label="Carregando capa..." />
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {!visible && <Placeholder label="Carregando capa..." />}

      {visible && state === "ready" && poster && (
        <>
          <img src={poster} alt="" className={className} />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="rounded-full bg-black/55 p-2 text-white">
              <Play size={18} fill="currentColor" />
            </span>
          </div>
        </>
      )}

      {visible && state === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-ig-surface">
          <div className="flex h-full items-center justify-center text-ig-muted">
            <Film size={24} strokeWidth={1.5} />
          </div>
        </div>
      )}

      {visible && state === "error" && (
        <video
          src={videoPreviewSrc(mediaUrl)}
          className={className}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = 0.1;
          }}
        />
      )}
    </div>
  );
}
