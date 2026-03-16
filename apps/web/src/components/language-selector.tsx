"use client";

import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "@redflag/shared";
import { Globe } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "redflag-response-language";

function detectBrowserLanguage(): SupportedLanguageCode {
  if (typeof navigator === "undefined") return "en";
  const browserCode = navigator.language.split("-")[0];
  const match = SUPPORTED_LANGUAGES.find((l) => l.code === browserCode);
  return (match?.code ?? "en") as SupportedLanguageCode;
}

function getStoredLanguage(): SupportedLanguageCode {
  if (typeof localStorage === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)) {
    return stored as SupportedLanguageCode;
  }
  return detectBrowserLanguage();
}

interface LanguageSelectorProps {
  value?: SupportedLanguageCode;
  onChange?: (code: SupportedLanguageCode) => void;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  const [language, setLanguage] = useState<SupportedLanguageCode>("en");

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
      <label htmlFor="response-language" className="text-xs text-slate-500">
        Explain in
      </label>
      <select
        id="response-language"
        value={language}
        onChange={handleChange}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 transition-colors hover:border-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
      >
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Hook to read the persisted language preference */
export function useResponseLanguage(): SupportedLanguageCode {
  const [language, setLanguage] = useState<SupportedLanguageCode>("en");

  useEffect(() => {
    setLanguage(getStoredLanguage());
  }, []);

  return language;
}
