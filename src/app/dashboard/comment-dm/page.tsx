import { redirect } from "next/navigation";
import { CommentDmPanel } from "@/components/CommentDmPanel";
import { getSessionUserId } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

export default async function CommentDmPage() {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/comment-dm");

  return (
    <div className="mx-auto max-w-4xl">
      <header className="ig-page-header">
        <h1>Automação de Comentários para DM</h1>
        <p>
          Transforme comentários com palavras-chave em mensagens privadas automáticas usando a API
          oficial da Meta.
        </p>
      </header>

      <CommentDmPanel />
    </div>
  );
}
