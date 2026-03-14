import { z } from "zod";

export const GateResultSchema = z.object({
  isContract: z.boolean(),
  contractType: z.string().nullable(),
  language: z.string().nullable(),
  reason: z.string(),
});

export type GateResult = z.infer<typeof GateResultSchema>;
