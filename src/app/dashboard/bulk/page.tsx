import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { BulkUploadForm } from "@/components/BulkUploadForm";
import { getSessionUserId } from "@/lib/meta/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstagramAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BulkPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login?next=/dashboard/bulk");

  const supabase = createAdminClient();
  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("user_id", userId);

  if (!accounts?.length) {
    return (
      <div>
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-8 text-center text-zinc-400">
          <p className="mb-4">Conecte uma conta Instagram primeiro.</p>
          <a href="/api/auth/meta?next=/dashboard/bulk" className="text-pink-400 hover:underline">
            Conectar conta
          </a>
        </main>
      </div>
    );
  }

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-white">Agendamento em massa</h1>
        <p className="mb-8 text-zinc-400">
          Envie vários vídeos e distribua automaticamente nos horários definidos.
        </p>
        <BulkUploadForm accounts={accounts as InstagramAccount[]} />
      </main>
    </div>
  );
}
