"use client";

import {
  AUTO_LANGUAGE_CODE,
  SUPPORTED_LANGUAGES,
  type SupportedLanguageCode,
} from "@redflag/shared";
import { Globe, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

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

  // Close tooltip on outside click
  useEffect(() => {
    if (!showTooltip) return;
    const handleClick = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showTooltip]);

  return (
    <div className="flex flex-wrap items-center gap-2">
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
      <div ref={tooltipRef} className="group relative">
        <button
          type="button"
          onClick={() => setShowTooltip((prev) => !prev)}
          className="text-slate-500 transition-colors hover:text-slate-300"
          aria-label="Language selector info"
        >
          <Info className="size-3.5" strokeWidth={1.5} />
        </button>
        <div
          className={`pointer-events-none absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-white/10 bg-[#131B2E] px-3 py-2 text-xs leading-relaxed text-slate-300 shadow-xl transition-opacity sm:left-1/2 sm:right-auto sm:-translate-x-1/2 ${showTooltip ? "pointer-events-auto opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
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
