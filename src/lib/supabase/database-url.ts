export type DatabaseCredentialMode =
  | "DATABASE_URL"
  | "SUPABASE_DB_URL"
  | "POSTGRES_URL"
  | "SUPABASE_DB_PASSWORD"
  | null;

export function resolveDatabaseCredentialMode(): DatabaseCredentialMode {
  if (process.env.DATABASE_URL?.trim()) return "DATABASE_URL";
  if (process.env.SUPABASE_DB_URL?.trim()) return "SUPABASE_DB_URL";
  if (process.env.POSTGRES_URL?.trim()) return "POSTGRES_URL";
  if (
    process.env.SUPABASE_DB_PASSWORD?.trim() &&
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  ) {
    return "SUPABASE_DB_PASSWORD";
  }
  return null;
}

function withSslMode(connectionString: string) {
  if (/[?&]sslmode=/i.test(connectionString)) return connectionString;
  const separator = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${separator}sslmode=require`;
}

export function resolveDatabaseUrl() {
  const mode = resolveDatabaseCredentialMode();
  if (mode === "DATABASE_URL") return withSslMode(process.env.DATABASE_URL!.trim());
  if (mode === "SUPABASE_DB_URL") return withSslMode(process.env.SUPABASE_DB_URL!.trim());
  if (mode === "POSTGRES_URL") return withSslMode(process.env.POSTGRES_URL!.trim());

  if (mode === "SUPABASE_DB_PASSWORD") {
    const password = process.env.SUPABASE_DB_PASSWORD!.trim();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const region = process.env.SUPABASE_DB_REGION?.trim() || "us-east-1";
    return withSslMode(
      `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
    );
  }

  return null;
}
