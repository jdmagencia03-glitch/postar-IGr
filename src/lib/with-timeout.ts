/** Evita bloqueio indefinido em chamadas ao Supabase/rede durante incidentes. */
export async function withHardTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.error("[db-hard-timeout]", { label, timeoutMs });
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error("[db-query-failed]", { label, error });
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.error("[db-timeout-fallback]", { label, ms });
          resolve(fallback);
        }, ms);
      }),
    ]);
  } catch (error) {
    console.error("[db-error-fallback]", { label, error });
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Igual a withTimeout, mas retorna null quando expira (útil quando fallback === valor válido). */
export async function withTimeoutOrNull<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      promise.then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => {
          console.error("[db-timeout-fallback]", { label, ms });
          resolve({ ok: false });
        }, ms);
      }),
    ]);
    return result.ok ? result.value : null;
  } catch (error) {
    console.error("[db-error-fallback]", { label, error });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const DB_ROUTE_TIMEOUT_MS = 8_000;
export const DB_LAYOUT_TIMEOUT_MS = 5_000;
