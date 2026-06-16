import { decryptSecret, encryptSecret } from "@/lib/security/crypto";

export function encryptPageAccessToken(token: string) {
  return encryptSecret(token);
}

export function decryptPageAccessToken(stored: string | null | undefined) {
  if (!stored) return null;
  return decryptSecret(stored);
}

export function encryptSessionAccessToken(token: string) {
  return encryptSecret(token);
}

export function decryptSessionAccessToken(stored: string | null | undefined) {
  if (!stored) return null;
  return decryptSecret(stored);
}

export function encryptTikTokAccessToken(token: string) {
  return encryptSecret(token);
}

export function decryptTikTokAccessToken(stored: string | null | undefined) {
  if (!stored) return null;
  return decryptSecret(stored);
}

export function encryptTikTokRefreshToken(token: string) {
  return encryptSecret(token);
}

export function decryptTikTokRefreshToken(stored: string | null | undefined) {
  if (!stored) return null;
  return decryptSecret(stored);
}
