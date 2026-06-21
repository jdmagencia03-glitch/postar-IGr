import { z } from "zod";

/** owner_id no sistema pode ser UUID ou ID numérico Meta (ex.: 27486801351006929). */
export const OwnerIdSchema = z.string().min(1, "ownerId obrigatório");

export const OptionalOwnerIdSchema = OwnerIdSchema.nullable().optional();
