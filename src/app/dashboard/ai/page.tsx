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
        <AiPlaybookForm />
      </main>
    </div>
  );
}
