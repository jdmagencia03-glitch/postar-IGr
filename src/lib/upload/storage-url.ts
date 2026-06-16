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

/** Supabase exige 6MB por chunk no TUS (por enquanto). */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
