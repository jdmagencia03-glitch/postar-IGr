import { NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/api-errors";
import { uuidSchema } from "@/lib/api/schemas/common";

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export function validationErrorResponse(error: z.ZodError) {
  return NextResponse.json({ error: formatZodError(error) }, { status: 400 });
}

export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParseResult<z.infer<S>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "JSON inválido ou corpo vazio." }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: validationErrorResponse(parsed.error) };
  }

  return { ok: true, data: parsed.data };
}

export function parseSearchParams<S extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: S,
): ParseResult<z.infer<S>> {
  const raw = Object.fromEntries(searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: validationErrorResponse(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

export async function parseRouteId(
  params: Promise<{ id: string }>,
): Promise<ParseResult<string>> {
  const { id } = await params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: "ID inválido." }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}
