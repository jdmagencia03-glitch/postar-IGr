import type { ZodError } from "zod";

export function formatZodError(error: ZodError): string {
  const messages = error.issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
  return messages.join(" · ") || "Dados inválidos";
}

export function formatApiError(error: unknown): string {
  if (error === null || error === undefined) return "Erro desconhecido";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.formErrors === "object" || Array.isArray(record.fieldErrors)) {
      const formErrors = Array.isArray(record.formErrors)
        ? record.formErrors.filter((item): item is string => typeof item === "string")
        : [];
      const fieldErrors = record.fieldErrors as Record<string, string[] | undefined> | undefined;
      const fieldMessages = fieldErrors
        ? Object.entries(fieldErrors).flatMap(([key, values]) =>
            (values ?? []).map((value) => `${key}: ${value}`),
          )
        : [];
      const combined = [...formErrors, ...fieldMessages];
      if (combined.length) return combined.join(" · ");
    }
  }
  return String(error);
}
