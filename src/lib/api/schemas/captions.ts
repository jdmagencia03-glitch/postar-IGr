import { z } from "zod";
import { optionalTrimmedString } from "@/lib/api/schemas/common";

export const captionGenerateSchema = z.object({
  topic: optionalTrimmedString(500),
  tone: optionalTrimmedString(80),
  username: optionalTrimmedString(80),
});
