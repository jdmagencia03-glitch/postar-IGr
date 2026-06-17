import { redirect } from "next/navigation";
import { AiPlaybookForm } from "@/components/AiPlaybookForm";
import { getSessionUserId } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

export default async function AiPlaybookPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/ai");

  return (
    <div className="mx-auto max-w-3xl">
      <header className="ig-page-header">
        <h1>Assistente de conteúdo</h1>
        <p>Defina nicho, tom e exemplos para a IA escrever como a sua página.</p>
      </header>
      <AiPlaybookForm />
    </div>
  );
}
