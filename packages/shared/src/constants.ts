export const MAX_PAGES = 30;
export const RATE_LIMIT_PER_DAY = 1;
export const RATE_LIMIT_AUTH_PER_DAY = 3;
export const VOYAGE_DIMENSIONS = 1024;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/** Maximum text length for DOCX/TXT files (~30 page equivalent at ~3000 chars/page) */
export const MAX_TEXT_LENGTH = 90_000;

/** Share links expire after this many days */
export const SHARE_LINK_EXPIRY_DAYS = 7;

/** Special language code meaning "use the document's detected language" */
export const AUTO_LANGUAGE_CODE = "auto" as const;

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
export const TXT_MIME = "text/plain" as const;

export const ACCEPTED_MIME_TYPES = ["application/pdf", DOCX_MIME, TXT_MIME] as const;

/**
 * Languages supported for AI response output.
 * Tier 1-2 quality from Anthropic multilingual benchmarks.
 * code = ISO 639-1, name = English, nativeName = endonym.
 */
export const SUPPORTED_LANGUAGES = [
  {
    code: "auto",
    name: "Document's original language",
    nativeName: "Document's original language",
  },
  { code: "en", name: "English", nativeName: "English" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
] as const;

export type SupportedLanguageCode =
  | typeof AUTO_LANGUAGE_CODE
  | (typeof SUPPORTED_LANGUAGES)[number]["code"];
