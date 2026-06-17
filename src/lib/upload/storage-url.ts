export function getSupabaseProjectRef(supabaseUrl: string) {
  return supabaseUrl.replace("https://", "").replace("http://", "").split(".")[0];
}

export function getSupabaseStorageHost(supabaseUrl: string) {
  const ref = getSupabaseProjectRef(supabaseUrl);
  return `https://${ref}.storage.supabase.co`;
}

export function getTusSignedEndpoint(supabaseUrl: string) {
  return `${getSupabaseStorageHost(supabaseUrl)}/storage/v1/upload/resumable/sign`;
}

export { TUS_CHUNK_SIZE } from "@/lib/upload/storage-config";
