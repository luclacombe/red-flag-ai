import { z } from "zod";
import { SUPPORTED_LANGUAGES } from "../constants";

const codes = SUPPORTED_LANGUAGES.map((l) => l.code) as [string, ...string[]];

export const ResponseLanguageSchema = z.enum(codes);
export type ResponseLanguage = z.infer<typeof ResponseLanguageSchema>;
