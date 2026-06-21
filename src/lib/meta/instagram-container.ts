import type { AuthProvider } from "@/lib/meta/instagram";

export class InstagramContainerProcessingError extends Error {
  readonly containerId: string;
  readonly statusCode: string;
  readonly graphError: string | null;
  readonly fbtraceId: string | null;
  readonly raw: Record<string, unknown>;

  constructor(params: {
    message: string;
    containerId: string;
    statusCode: string;
    graphError?: string | null;
    fbtraceId?: string | null;
    raw?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "InstagramContainerProcessingError";
    this.containerId = params.containerId;
    this.statusCode = params.statusCode;
    this.graphError = params.graphError ?? null;
    this.fbtraceId = params.fbtraceId ?? null;
    this.raw = params.raw ?? {};
  }

  logMessage() {
    const parts = [this.message];
    if (this.graphError) parts.push(`Graph: ${this.graphError}`);
    if (this.fbtraceId) parts.push(`fbtrace_id=${this.fbtraceId}`);
    parts.push(`container=${this.containerId}`);
    return parts.join(" | ");
  }
}

export function isInstagramContainerProcessingError(
  error: unknown,
): error is InstagramContainerProcessingError {
  return error instanceof InstagramContainerProcessingError;
}

export type ContainerStatusSnapshot = {
  statusCode: string;
  lastContainerStatus: "ERROR" | "IN_PROGRESS" | "FINISHED" | "UNKNOWN";
  graphError: string | null;
  fbtraceId: string | null;
  raw: Record<string, unknown>;
};

function getGraphBase(provider: AuthProvider = "instagram") {
  return provider === "facebook"
    ? "https://graph.facebook.com/v21.0"
    : "https://graph.instagram.com/v21.0";
}

function parseContainerStatus(data: Record<string, unknown>): ContainerStatusSnapshot {
  const statusCode = String(data.status_code ?? "UNKNOWN");
  let lastContainerStatus: ContainerStatusSnapshot["lastContainerStatus"] = "UNKNOWN";
  if (statusCode === "FINISHED") lastContainerStatus = "FINISHED";
  else if (statusCode === "ERROR") lastContainerStatus = "ERROR";
  else if (statusCode === "IN_PROGRESS") lastContainerStatus = "IN_PROGRESS";

  let graphError: string | null = null;
  const status = data.status;
  if (typeof status === "string" && status.trim()) {
    graphError = status;
  } else if (status && typeof status === "object") {
    const obj = status as Record<string, unknown>;
    graphError =
      (typeof obj.error_message === "string" && obj.error_message) ||
      (typeof obj.message === "string" && obj.message) ||
      JSON.stringify(obj);
  }

  const apiError = data.error as { message?: string; fbtrace_id?: string } | undefined;

  return {
    statusCode,
    lastContainerStatus,
    graphError: graphError ?? apiError?.message ?? null,
    fbtraceId: apiError?.fbtrace_id ?? null,
    raw: data,
  };
}

export async function fetchInstagramContainerStatus(params: {
  containerId: string;
  token: string;
  provider?: AuthProvider;
}): Promise<ContainerStatusSnapshot> {
  const provider = params.provider ?? "instagram";
  const graph = getGraphBase(provider);
  const fields = encodeURIComponent("status_code,status");
  const res = await fetch(
    `${graph}/${params.containerId}?fields=${fields}&access_token=${encodeURIComponent(params.token)}`,
    { cache: "no-store" },
  );
  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const apiError = data.error as { message?: string; fbtrace_id?: string } | undefined;
    return {
      statusCode: "UNKNOWN",
      lastContainerStatus: "UNKNOWN",
      graphError: apiError?.message ?? "Falha ao consultar container",
      fbtraceId: apiError?.fbtrace_id ?? null,
      raw: data,
    };
  }

  return parseContainerStatus(data);
}

export async function waitForInstagramContainer(params: {
  containerId: string;
  token: string;
  maxAttempts?: number;
  provider?: AuthProvider;
  pollIntervalMs?: number;
}) {
  const maxAttempts = params.maxAttempts ?? 30;
  const pollIntervalMs = params.pollIntervalMs ?? 3000;
  const provider = params.provider ?? "instagram";

  for (let i = 0; i < maxAttempts; i++) {
    const snapshot = await fetchInstagramContainerStatus({
      containerId: params.containerId,
      token: params.token,
      provider,
    });

    if (snapshot.lastContainerStatus === "FINISHED") return snapshot;
    if (snapshot.lastContainerStatus === "ERROR") {
      throw new InstagramContainerProcessingError({
        message: snapshot.graphError ?? "Processamento da mídia falhou no Instagram",
        containerId: params.containerId,
        statusCode: snapshot.statusCode,
        graphError: snapshot.graphError,
        fbtraceId: snapshot.fbtraceId,
        raw: snapshot.raw,
      });
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("Timeout aguardando processamento da mídia");
}
