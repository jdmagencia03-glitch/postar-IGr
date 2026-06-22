import { NextResponse } from "next/server";
import { getSessionAuth } from "@/lib/auth/api-session";

export async function GET() {
  const session = await getSessionAuth();

  if (session.ok) {
    return NextResponse.json({
      authenticated: true,
      source: session.source,
    });
  }

  if (session.reason === "db_timeout") {
    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        error: "auth_timeout",
        message: session.message,
      },
      { status: 503 },
    );
  }

  if (session.reason === "db_error") {
    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        error: "auth_db_error",
        message: session.message,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ authenticated: false });
}
