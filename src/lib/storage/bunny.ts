import {
  deleteBunnyStreamVideo,
  getBunnyStreamConfig,
  headBunnyStreamVideo,
  isBunnyStreamEnabled,
  parseBunnyStreamStorageKey,
  parseBunnyStreamVideoIdFromUrl,
} from "@/lib/storage/bunny-stream";

const BUNNY_REGION_HOSTS: Record<string, string> = {
  de: "de.storage.bunnycdn.com",
  ny: "ny.storage.bunnycdn.com",
  la: "la.storage.bunnycdn.com",
  sg: "sg.storage.bunnycdn.com",
  syd: "syd.storage.bunnycdn.com",
  uk: "uk.storage.bunnycdn.com",
  se: "se.storage.bunnycdn.com",
  br: "br.storage.bunnycdn.com",
  jh: "jh.storage.bunnycdn.com",
};

export type BunnyStorageConfig = {
  zoneName: string;
  accessKey: string;
  regionHost: string;
  cdnHostname: string;
};

export function getBunnyStorageConfig(): BunnyStorageConfig | null {
  const zoneName = process.env.BUNNY_STORAGE_ZONE?.trim();
  const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY?.trim();
  const cdnHostname = process.env.BUNNY_CDN_HOSTNAME?.trim();
  const region = (process.env.BUNNY_STORAGE_REGION?.trim() || "br").toLowerCase();
  const regionHost = BUNNY_REGION_HOSTS[region] ?? BUNNY_REGION_HOSTS.br;

  if (!zoneName || !accessKey || !cdnHostname) return null;

  return { zoneName, accessKey, regionHost, cdnHostname };
}

export function isBunnyStorageEnabled() {
  return getBunnyStorageConfig() !== null;
}

export type BunnyMediaBackend = "stream" | "storage" | "none";

export function getBunnyMediaBackend(): BunnyMediaBackend {
  const forced = process.env.BUNNY_MEDIA_BACKEND?.trim().toLowerCase();
  if (forced === "stream" && isBunnyStreamEnabled()) return "stream";
  if (forced === "storage" && isBunnyStorageEnabled()) return "storage";
  if (isBunnyStreamEnabled()) return "stream";
  if (isBunnyStorageEnabled()) return "storage";
  return "none";
}

export function isBunnyMediaEnabled() {
  return getBunnyMediaBackend() !== "none";
}

export function getMediaStorageProvider(): "bunny" | "supabase" {
  const forced = process.env.MEDIA_STORAGE_PROVIDER?.trim().toLowerCase();
  if (forced === "bunny") return "bunny";
  if (forced === "supabase") return "supabase";
  return isBunnyMediaEnabled() ? "bunny" : "supabase";
}

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildBunnyStorageApiUrl(storagePath: string, config = getBunnyStorageConfig()) {
  if (!config) return null;
  const encoded = encodeStoragePath(storagePath);
  return `https://${config.regionHost}/${config.zoneName}/${encoded}`;
}

export function buildBunnyCdnUrl(storagePath: string, config = getBunnyStorageConfig()) {
  if (!config) return null;
  const encoded = encodeStoragePath(storagePath);
  return `https://${config.cdnHostname}/${encoded}`;
}

export function parseBunnyCdnStoragePath(url: string, config = getBunnyStorageConfig()): string | null {
  if (!config) return null;
  try {
    const parsed = new URL(url);
    const host = config.cdnHostname.toLowerCase();
    if (parsed.host.toLowerCase() !== host) return null;
    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return path || null;
  } catch {
    return null;
  }
}

export async function deleteBunnyMediaObject(storagePath: string, publicUrl?: string | null) {
  const streamVideoId =
    parseBunnyStreamStorageKey(storagePath) ??
    (publicUrl ? parseBunnyStreamVideoIdFromUrl(publicUrl) : null);

  if (streamVideoId) {
    return deleteBunnyStreamVideo(streamVideoId);
  }

  return deleteBunnyStorageObject(storagePath);
}

export async function headBunnyMediaObject(storagePath: string, publicUrl?: string | null) {
  const streamVideoId =
    parseBunnyStreamStorageKey(storagePath) ??
    (publicUrl ? parseBunnyStreamVideoIdFromUrl(publicUrl) : null);

  if (streamVideoId) {
    return headBunnyStreamVideo(streamVideoId);
  }

  return headBunnyCdnObject(storagePath);
}

export async function deleteBunnyStorageObject(storagePath: string) {
  const config = getBunnyStorageConfig();
  const url = buildBunnyStorageApiUrl(storagePath, config);
  if (!config || !url) {
    throw new Error("Bunny Storage não configurado");
  }

  const res = await fetch(url, {
    method: "DELETE",
    headers: { AccessKey: config.accessKey },
  });

  if (res.status === 404) return { deleted: false, status: 404 };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao apagar no Bunny (${res.status}): ${body || res.statusText}`);
  }

  return { deleted: true, status: res.status };
}

export async function headBunnyCdnObject(storagePath: string) {
  const url = buildBunnyCdnUrl(storagePath);
  if (!url) {
    return { exists: false, size: null, mimeType: null, error: "bunny_not_configured" };
  }

  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.status === 404) {
      return { exists: false, size: null, mimeType: null, error: null };
    }
    if (!res.ok) {
      return {
        exists: false,
        size: null,
        mimeType: null,
        error: `http_${res.status}`,
      };
    }

    const length = res.headers.get("content-length");
    const size = length ? Number(length) : null;

    return {
      exists: true,
      size: Number.isFinite(size) ? size : null,
      mimeType: res.headers.get("content-type"),
      error: null,
    };
  } catch (error) {
    return {
      exists: false,
      size: null,
      mimeType: null,
      error: error instanceof Error ? error.message : "head_failed",
    };
  }
}
