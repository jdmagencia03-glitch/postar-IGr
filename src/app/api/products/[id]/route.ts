import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { productPatchSchema } from "@/lib/api/schemas/products";
import { parseJsonBody, parseRouteId } from "@/lib/api/validate-request";
import { getOwnerProduct, productInputFromBody } from "@/lib/products/products";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const idParsed = await parseRouteId(params);
  if (!idParsed.ok) return idParsed.response;

  const supabase = createAdminClient();
  const product = await getOwnerProduct(supabase, ownerId, idParsed.data);

  if (!product) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  return NextResponse.json(product);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const idParsed = await parseRouteId(params);
  if (!idParsed.ok) return idParsed.response;

  const supabase = createAdminClient();
  const existing = await getOwnerProduct(supabase, ownerId, idParsed.data);
  if (!existing) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });

  const parsed = await parseJsonBody(request, productPatchSchema);
  if (!parsed.ok) return parsed.response;

  const input = productInputFromBody({ ...existing, ...parsed.data });

  const { data, error } = await supabase
    .from("products")
    .update(input)
    .eq("id", idParsed.data)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const idParsed = await parseRouteId(params);
  if (!idParsed.ok) return idParsed.response;

  const supabase = createAdminClient();
  const existing = await getOwnerProduct(supabase, ownerId, idParsed.data);
  if (!existing) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });

  const { error } = await supabase.from("products").delete().eq("id", idParsed.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
