type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };

  // Vercel captures structured JSON from console.log natively
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info(message: string, metadata?: Record<string, unknown>): void {
    emit("info", message, metadata);
  },
  warn(message: string, metadata?: Record<string, unknown>): void {
    emit("warn", message, metadata);
  },
  error(message: string, metadata?: Record<string, unknown>): void {
    emit("error", message, metadata);
  },
};
