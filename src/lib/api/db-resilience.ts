import { NextResponse } from "next/server";

export function dbTimeoutJsonResponse<T>(data: T = [] as T) {
  return NextResponse.json(
    {
      ok: false,
      error: "db_timeout",
      message: "Banco temporariamente lento",
      data,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
