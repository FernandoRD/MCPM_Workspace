import { invoke } from "@tauri-apps/api/core";

type FrontendLogLevel = "debug" | "info" | "warn" | "error";

function serializeError(error: unknown): Record<string, unknown> | unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "object" && error !== null) {
    return error;
  }

  if (typeof error === "string") {
    return { message: error };
  }

  return error;
}

function normalizeMessage(message: string, error?: unknown): string {
  if (message.trim()) return message.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Erro sem mensagem";
}

export async function logFrontendEvent(
  level: FrontendLogLevel,
  source: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await invoke("write_frontend_log", {
      level,
      source,
      message,
      context: context ?? null,
    });
  } catch {
    // Evita recursão quando o bridge Tauri falha.
  }
}

export function logFrontendError(
  source: string,
  message: string,
  error?: unknown,
  context?: Record<string, unknown>,
): void {
  void logFrontendEvent("error", source, normalizeMessage(message, error), {
    ...context,
    error: serializeError(error),
  });
}

export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (event) => {
    logFrontendError(
      "window.error",
      event.message || "Erro global não tratado",
      event.error,
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    logFrontendError(
      "window.unhandledrejection",
      "Promise rejeitada sem tratamento",
      event.reason,
    );
  });
}
