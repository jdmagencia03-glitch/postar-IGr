import { redirect } from "next/navigation";
import { ProductsManager } from "@/components/products/ProductsManager";
import { getSessionUserId } from "@/lib/meta/oauth";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const ownerId = await getSessionUserId();
  if (!ownerId) redirect("/login?next=/dashboard/products");

  const params = await searchParams;

  return (
    <>
      <header className="ig-page-header">
        <h1>Produtos / Ofertas</h1>
        <p>Cadastre produtos que serão vendidos pelas suas páginas.</p>
      </header>
      <ProductsManager initialId={params.id} />
    </>
  );
}
