/** Fetch no cliente com timeout — evita spinner infinito quando API trava. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 3_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function parseAccountsListPayload(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (
    json &&
    typeof json === "object" &&
    "data" in json &&
    Array.isArray((json as { data: unknown }).data)
  ) {
    return (json as { data: unknown[] }).data;
  }
  return [];
}
