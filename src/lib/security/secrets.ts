import { isProduction } from "@/lib/auth/session-core";

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;

  if (isProduction()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return "";
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;

  if (isProduction()) {
    throw new Error("Missing required environment variable: SESSION_SECRET");
  }

  return "dev-only-session-secret-change-me";
}

export function getCronSecret(): string {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) return secret;

  if (isProduction()) {
    throw new Error("Missing required environment variable: CRON_SECRET");
  }

  return "dev-only-cron-secret-change-me";
}

export function getTokenEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim() || getSessionSecret();
  return Buffer.from(raw.padEnd(32, "0").slice(0, 32));
}
