import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/meta/oauth";
import { listStatusSchema } from "@/lib/api/schemas/common";
import { productBodySchema } from "@/lib/api/schemas/products";
import { parseJsonBody, parseSearchParams } from "@/lib/api/validate-request";
import { listOwnerProducts, productInputFromBody } from "@/lib/products/products";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const listQuerySchema = z.object({
  status: listStatusSchema,
});

export async function GET(request: NextRequest) {
  const ownerId = await getSessionUserId();
  if (!ownerId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const query = parseSearchParams(request.nextUrl.searchParams, listQuerySchema);
  if (!query.ok) return query.response;

  const supabase = createAdminClient();

  try {
    const products = await listOwnerProducts(
      supabase,
      ownerId,
      query.data.status === "all" ? "all" : query.data.status,
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

  const parsed = await parseJsonBody(request, productBodySchema);
  if (!parsed.ok) return parsed.response;

  const input = productInputFromBody(parsed.data);
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
