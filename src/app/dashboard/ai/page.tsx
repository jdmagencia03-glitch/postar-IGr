import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AiPlaybookForm } from "@/components/AiPlaybookForm";
import { getSessionUserId } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

export default async function AiPlaybookPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/ai");

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold text-white">Treinar IA (GPT)</h1>
        <p className="mb-8 text-zinc-400">
          Alimente a IA com conteúdo sobre legendas, ganchos e hashtags. Ela{" "}
          <strong className="text-zinc-300">não edita vídeos</strong> — apenas escreve as legendas e
          o sistema define os melhores horários do dia.
        </p>
        <AiPlaybookForm />
      </main>
    </div>
  );
}
