import { MAX_UPLOAD_BYTES } from "@/lib/upload/storage-config";

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"];
const ALLOWED_MIMES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];

export interface ValidatedFile {
  file: File;
  fingerprint: string;
}

export interface InvalidFile {
  file: File;
  reason: string;
}

export interface DuplicateFile {
  file: File;
  fingerprint: string;
  existingFilename: string;
}

export interface ValidationResult {
  valid: ValidatedFile[];
  invalid: InvalidFile[];
  duplicates: DuplicateFile[];
}

export function buildFileFingerprint(file: File) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function hasAllowedExtension(name: string) {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function validateFiles(
  files: File[],
  existingFingerprints: Set<string> = new Set(),
  maxBytes: number = MAX_UPLOAD_BYTES,
): ValidationResult {
  const valid: ValidatedFile[] = [];
  const invalid: InvalidFile[] = [];
  const duplicates: DuplicateFile[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const fingerprint = buildFileFingerprint(file);

    if (!hasAllowedExtension(file.name) && !ALLOWED_MIMES.includes(file.type)) {
      invalid.push({ file, reason: "Formato não suportado (use MP4, MOV ou WEBM)" });
      continue;
    }

    if (file.size > maxBytes) {
      const limitLabel =
        maxBytes >= 1024 * 1024 * 1024
          ? `${(maxBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
          : maxBytes >= 1024 * 1024
            ? `${Math.round(maxBytes / (1024 * 1024))} MB`
            : `${Math.round(maxBytes / 1024)} KB`;
      invalid.push({ file, reason: `Arquivo maior que ${limitLabel}` });
      continue;
    }

    if (file.size === 0) {
      invalid.push({ file, reason: "Arquivo vazio" });
      continue;
    }

    if (seen.has(fingerprint)) {
      duplicates.push({ file, fingerprint, existingFilename: file.name });
      continue;
    }

    if (existingFingerprints.has(fingerprint)) {
      duplicates.push({ file, fingerprint, existingFilename: file.name });
      continue;
    }

    seen.add(fingerprint);
    valid.push({ file, fingerprint });
  }

  return { valid, invalid, duplicates };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSecond: number) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)} seg`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins} min ${secs}s`;
}
