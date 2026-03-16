"use client";

import type { SupportedLanguageCode } from "@redflag/shared";
import { AlertCircle, Clock, FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { LanguageSelector, useResponseLanguage } from "./language-selector";
import { ProcessingLoader } from "./processing-loader";

type UploadState =
  | { status: "idle" }
  | { status: "drag-over" }
  | { status: "uploading"; filename: string; size: number; progress: number }
  | { status: "processing"; filename: string }
  | { status: "error"; message: string }
  | { status: "rejection"; reason: string }
  | { status: "rate-limit"; resetTime: string };

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone() {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [responseLanguage, setResponseLanguage] = useState<SupportedLanguageCode>(
    useResponseLanguage(),
  );

  const handleFile = useCallback(
    async (file: File) => {
      // Client-side validation: accepted file types
      const acceptedTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ];
      const acceptedExtensions = [".pdf", ".docx", ".txt"];
      const hasValidType = acceptedTypes.includes(file.type);
      const hasValidExtension = acceptedExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!hasValidType && !hasValidExtension) {
        setState({
          status: "rejection",
          reason: "Please upload a PDF, DOCX, or TXT file. Other formats are not supported.",
        });
        return;
      }

      // Client-side validation: size
      if (file.size > MAX_FILE_SIZE) {
        setState({
          status: "rejection",
          reason: `File too large (${formatFileSize(file.size)}). Maximum size is 10MB.`,
        });
        return;
      }

      // Start upload
      setState({
        status: "uploading",
        filename: file.name,
        size: file.size,
        progress: 0,
      });

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("responseLanguage", responseLanguage);

        // Use XMLHttpRequest for upload progress tracking
        const response = await new Promise<Response>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const progress = Math.round((e.loaded / e.total) * 100);
              setState((prev) => (prev.status === "uploading" ? { ...prev, progress } : prev));
            }
          });

          xhr.addEventListener("load", () => {
            resolve(
              new Response(xhr.responseText, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers: { "Content-Type": "application/json" },
              }),
            );
          });

          xhr.addEventListener("error", () => {
            reject(new Error("Network error during upload"));
          });

          xhr.open("POST", "/api/upload");
          xhr.send(formData);
        });

        // Show processing state while gate runs
        setState({ status: "processing", filename: file.name });

        const data = await response.json();

        if (response.status === 429) {
          setState({
            status: "rate-limit",
            resetTime: data.resetTime ?? "midnight UTC",
          });
          return;
        }

        if (!response.ok) {
          setState({
            status: "error",
            message: data.error ?? "Upload failed. Please try again.",
          });
          return;
        }

        if (data.isContract === false) {
          setState({ status: "rejection", reason: data.reason });
          return;
        }

        if (data.isContract === true && data.analysisId) {
          router.push(`/analysis/${data.analysisId}`);
          return;
        }

        setState({
          status: "error",
          message: "Unexpected response from server.",
        });
      } catch {
        setState({
          status: "error",
          message: "Network error. Please check your connection and try again.",
        });
      }
    },
    [router, responseLanguage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setState({ status: "idle" });

      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState({ status: "drag-over" });
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState({ status: "idle" });
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset input so same file can be selected again
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFile],
  );

  const handleClick = useCallback(() => {
    if (state.status === "uploading" || state.status === "processing") return;
    inputRef.current?.click();
  }, [state.status]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const resetState = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const isInteractive = state.status !== "uploading" && state.status !== "processing";

  return (
    <div className="w-full">
      {/* biome-ignore lint/a11y/useSemanticElements: div needed for drag-drop zone — button cannot receive drag events */}
      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label="Upload contract file"
        aria-describedby={
          state.status === "error" || state.status === "rejection" ? "upload-message" : undefined
        }
        className={cn(
          "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-150 md:p-12",
          isInteractive && "cursor-pointer",
          state.status === "drag-over"
            ? "border-amber-500 bg-amber-50/50"
            : state.status === "error" || state.status === "rejection"
              ? "border-red-300 bg-red-50/30"
              : "border-slate-300 bg-slate-50 hover:border-slate-400",
          (state.status === "uploading" || state.status === "processing") &&
            "pointer-events-none opacity-80",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          onChange={handleInputChange}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Idle + drag-over state */}
        {(state.status === "idle" || state.status === "drag-over") && (
          <>
            <Upload className="size-10 text-slate-400" strokeWidth={1.5} />
            <p className="mt-4 font-heading text-base font-semibold text-slate-700">
              Drop your contract here
            </p>
            <p className="mt-1 text-sm text-slate-500">or click to browse</p>
            <p className="mt-3 text-xs text-slate-400">PDF, DOCX, or TXT &middot; Max 10MB</p>
          </>
        )}

        {/* Uploading state */}
        {state.status === "uploading" && (
          <>
            <FileText className="size-10 text-amber-500" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium text-slate-700">{state.filename}</p>
            <p className="mt-0.5 text-xs text-slate-500">{formatFileSize(state.size)}</p>
            <div className="mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-300 ease-out"
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">Uploading... {state.progress}%</p>
          </>
        )}

        {/* Processing state */}
        {state.status === "processing" && (
          <>
            <FileText className="size-10 text-amber-500" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium text-slate-700">{state.filename}</p>
            <div className="mt-4">
              <ProcessingLoader />
            </div>
          </>
        )}
      </div>

      {/* Language selector — below the zone, only when idle or showing errors */}
      {(state.status === "idle" ||
        state.status === "drag-over" ||
        state.status === "error" ||
        state.status === "rejection" ||
        state.status === "rate-limit") && (
        <div className="mt-3 flex justify-center">
          <LanguageSelector value={responseLanguage} onChange={setResponseLanguage} />
        </div>
      )}

      {/* Error / rejection / rate-limit messages below the zone */}
      {state.status === "error" && (
        <div
          id="upload-message"
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700">{state.message}</p>
            <button
              type="button"
              onClick={resetState}
              className="mt-2 cursor-pointer text-sm font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {state.status === "rejection" && (
        <div
          id="upload-message"
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700">{state.reason}</p>
            <button
              type="button"
              onClick={resetState}
              className="mt-2 cursor-pointer text-sm font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
            >
              Upload a different file
            </button>
          </div>
        </div>
      )}

      {state.status === "rate-limit" && (
        <div
          id="upload-message"
          className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4"
        >
          <Clock className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-sm font-medium text-amber-700">
            You&apos;ve reached the daily analysis limit. You can try again at {state.resetTime}.
          </p>
        </div>
      )}
    </div>
  );
}
