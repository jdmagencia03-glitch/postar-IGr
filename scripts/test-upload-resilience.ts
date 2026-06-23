import assert from "node:assert/strict";
import {
  UPLOAD_FILE_MAX_ATTEMPTS,
  UPLOAD_FILE_RETRY_DELAYS_MS,
  classifyUploadError,
} from "@/lib/upload/network-retry";
import {
  UPLOAD_CONCURRENCY_DEFAULT,
  getEffectiveUploadConcurrency,
  MAX_SAFE_UPLOAD_CONCURRENCY,
} from "@/lib/upload/storage-config";

function run() {
  // retry com backoff: imediato + 2s + 6s + 15s
  assert.deepEqual([...UPLOAD_FILE_RETRY_DELAYS_MS], [2_000, 6_000, 15_000]);
  assert.equal(UPLOAD_FILE_MAX_ATTEMPTS, 4);

  // 404 precisa ser recuperável para forçar renovação de sessão
  const expiredError = new Error("Not Found") as Error & {
    originalResponse?: { getStatus?: () => number };
  };
  expiredError.originalResponse = { getStatus: () => 404 };
  const expired = classifyUploadError(expiredError);
  assert.equal(expired.kind, "url_expired");
  assert.equal(expired.recoverable, true);

  // 409 precisa ser recuperável para reconciliar conflito
  const conflictError = new Error("Conflict") as Error & {
    originalResponse?: { getStatus?: () => number };
  };
  conflictError.originalResponse = { getStatus: () => 409 };
  const conflict = classifyUploadError(conflictError);
  assert.equal(conflict.kind, "conflict");
  assert.equal(conflict.recoverable, true);

  // concorrência padrão + teto seguro (padrão = limite do navegador)
  assert.equal(UPLOAD_CONCURRENCY_DEFAULT, 4);
  const effective = getEffectiveUploadConcurrency();
  assert.equal(effective.economy, 2);
  assert.equal(effective.normal, 4);
  assert.equal(effective.turbo, 6);
  assert.ok(effective.turbo <= MAX_SAFE_UPLOAD_CONCURRENCY);

  console.log("upload-resilience tests: OK");
}

run();
