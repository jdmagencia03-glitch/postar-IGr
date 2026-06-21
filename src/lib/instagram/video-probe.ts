import { spawn } from "child_process";

export type VideoUrlProbe = {
  videoUrl: string;
  hasVideo: boolean;
  videoUrlAccessible: boolean;
  httpStatus: number | null;
  contentType: string | null;
  contentLength: number | null;
  isPublicUrl: boolean;
  looksLikeHtml: boolean;
  zeroBytes: boolean;
  probeError: string | null;
};

export type FfprobeSummary = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  container: string | null;
};

function parseContentLength(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function looksLikeHtmlContentType(contentType: string | null) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xml") || ct.includes("text/xml");
}

function isLikelyPublicUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchHeadOrGet(url: string) {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", cache: "no-store" });
    if (head.ok) {
      return {
        ok: head.ok,
        status: head.status,
        contentType: head.headers.get("content-type"),
        contentLength: head.headers.get("content-length"),
      };
    }
  } catch {
    // fall through to GET
  }

  try {
    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { Range: "bytes=0-8191" },
    });
    return {
      ok: get.ok,
      status: get.status,
      contentType: get.headers.get("content-type"),
      contentLength: get.headers.get("content-range")?.split("/")[1] ?? get.headers.get("content-length"),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: null,
      contentLength: null,
      error: error instanceof Error ? error.message : "Falha ao acessar URL",
    };
  }
}

export async function probeVideoUrl(videoUrl: string | null | undefined): Promise<VideoUrlProbe> {
  if (!videoUrl) {
    return {
      videoUrl: "",
      hasVideo: false,
      videoUrlAccessible: false,
      httpStatus: null,
      contentType: null,
      contentLength: null,
      isPublicUrl: false,
      looksLikeHtml: false,
      zeroBytes: false,
      probeError: "Post sem videoUrl",
    };
  }

  const result = await fetchHeadOrGet(videoUrl);
  if ("error" in result && result.error) {
    return {
      videoUrl,
      hasVideo: true,
      videoUrlAccessible: false,
      httpStatus: result.status,
      contentType: result.contentType,
      contentLength: parseContentLength(result.contentLength),
      isPublicUrl: isLikelyPublicUrl(videoUrl),
      looksLikeHtml: false,
      zeroBytes: false,
      probeError: result.error,
    };
  }

  const contentType = result.contentType;
  const contentLength = parseContentLength(result.contentLength);
  const looksLikeHtml = looksLikeHtmlContentType(contentType);
  const isVideo =
    Boolean(contentType?.toLowerCase().includes("video/")) ||
    /\.(mp4|mov|webm)(\?|$)/i.test(videoUrl);

  return {
    videoUrl,
    hasVideo: true,
    videoUrlAccessible: Boolean(result.ok && result.status !== null && result.status < 400),
    httpStatus: result.status,
    contentType,
    contentLength,
    isPublicUrl: isLikelyPublicUrl(videoUrl),
    looksLikeHtml,
    zeroBytes: contentLength === 0,
    probeError: null,
  };
}

export async function runFfprobeIfAvailable(url: string): Promise<FfprobeSummary | null> {
  return new Promise((resolve) => {
    const args = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      url,
    ];

    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    proc.on("error", () => resolve(null));

    proc.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        if (stderr.includes("not found") || stderr.includes("ENOENT")) {
          resolve(null);
          return;
        }
        resolve(null);
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string; bit_rate?: string; format_name?: string };
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
            r_frame_rate?: string;
          }>;
        };

        const video = parsed.streams?.find((s) => s.codec_type === "video");
        const audio = parsed.streams?.find((s) => s.codec_type === "audio");
        let fps: number | null = null;
        if (video?.r_frame_rate?.includes("/")) {
          const [num, den] = video.r_frame_rate.split("/").map(Number);
          if (den) fps = Math.round((num / den) * 100) / 100;
        }

        resolve({
          durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
          width: video?.width ?? null,
          height: video?.height ?? null,
          fps,
          videoCodec: video?.codec_name ?? null,
          audioCodec: audio?.codec_name ?? null,
          bitrate: parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null,
          container: parsed.format?.format_name ?? null,
        });
      } catch {
        resolve(null);
      }
    });
  });
}
