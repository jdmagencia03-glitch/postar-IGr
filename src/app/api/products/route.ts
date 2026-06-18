import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { listOwnerProducts, productInputFromBody } from "@/lib/products/products";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const status = request.nextUrl.searchParams.get("status") ?? "all";
  const supabase = createAdminClient();

  try {
    const products = await listOwnerProducts(
      supabase,
      ownerId,
      status === "active" || status === "paused" ? status : "all",
    );
    return NextResponse.json({ products });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar produtos" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await request.json();
  const input = productInputFromBody(body);
  if (!input.name) {
    return NextResponse.json({ error: "Nome do produto é obrigatório" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ ...input, owner_id: ownerId })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
