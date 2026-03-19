"use client";

import {
  AUTO_LANGUAGE_CODE,
  SUPPORTED_LANGUAGES,
  type SupportedLanguageCode,
} from "@redflag/shared";
import { Globe, Info } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "redflag-response-language";

function getStoredLanguage(): SupportedLanguageCode {
  if (typeof localStorage === "undefined") return AUTO_LANGUAGE_CODE;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)) {
    return stored as SupportedLanguageCode;
  }
  return AUTO_LANGUAGE_CODE;
}

interface LanguageSelectorProps {
  value?: SupportedLanguageCode;
  onChange?: (code: SupportedLanguageCode) => void;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  const [language, setLanguage] = useState<SupportedLanguageCode>(AUTO_LANGUAGE_CODE);

  useEffect(() => {
    setLanguage(value ?? getStoredLanguage());
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const code = e.target.value as SupportedLanguageCode;
      setLanguage(code);
      localStorage.setItem(STORAGE_KEY, code);
      onChange?.(code);
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2">
      <Globe className="size-4 text-slate-400" strokeWidth={1.5} />
      <label htmlFor="response-language" className="text-xs text-slate-400">
        Risk analysis in
      </label>
      <div className="relative">
        <select
          id="response-language"
          value={language}
          onChange={handleChange}
          className="cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/5 py-1 pl-3 pr-8 text-sm text-slate-300 transition-colors hover:border-white/20 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>
      <div className="group relative">
        <Info
          className="size-3.5 cursor-help text-slate-500 transition-colors group-hover:text-slate-300"
          strokeWidth={1.5}
        />
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-lg border border-white/10 bg-[#131B2E] px-3 py-2 text-xs leading-relaxed text-slate-300 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
          Controls the language of risk explanations. Does not translate your document. Safer
          alternatives remain in the document&apos;s original language.
        </div>
      </div>
    </div>
  );
}

/** Hook to read the persisted language preference */
export function useResponseLanguage(): SupportedLanguageCode {
  const [language, setLanguage] = useState<SupportedLanguageCode>(AUTO_LANGUAGE_CODE);

  useEffect(() => {
    setLanguage(getStoredLanguage());
  }, []);

  return language;
}
