import { NextResponse } from "next/server";
import { requireApiSessionSafe } from "@/lib/auth/api-session";

const ROUTE = "/api/auth/session";

export async function GET() {
  try {
    const session = await requireApiSessionSafe(ROUTE);

    if (session.ok) {
      return NextResponse.json({
        authenticated: true,
        source: session.source,
      });
    }

    if (session.reason === "auth_timeout") {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: "auth_timeout",
          message: session.message,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (session.reason === "auth_db_error") {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: "auth_db_error",
          message: session.message,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({ authenticated: false });
  } catch (error) {
    console.error("[api-handler-failed]", { route: ROUTE, error });
    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        error: "auth_db_error",
        message: "Erro temporário ao validar sessão.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
