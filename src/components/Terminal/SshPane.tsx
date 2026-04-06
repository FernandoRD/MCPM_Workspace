import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/store/settings";
import { useSessionsStore } from "@/store/sessions";

interface SshPaneProps {
  paneId: string;
  host: string;
  port: number;
  authMethod: string;
  username: string;
  password: string | null;
  privateKeyContent: string | null;
  passphrase: string | null;
  sshCompatPreset?: string;
  onStatusChange: (paneId: string, status: "connecting" | "connected" | "disconnected" | "error") => void;
  onConnected: () => void;
  onDisconnected?: (status: "disconnected" | "error") => void;
}

interface SshOutputEvent { tab_id: string; data: string }
interface SshStatusEvent { tab_id: string; status: "connecting" | "connected" | "disconnected" | "error"; message?: string }

function writeBase64Chunk(term: Terminal | null, chunk: string) {
  if (!term) return;
  try {
    const bytes = Uint8Array.from(atob(chunk), (c) => c.charCodeAt(0));
    term.write(bytes);
  } catch {
    term.write(chunk);
  }
}

export function SshPane({
  paneId,
  host,
  port,
  authMethod,
  username,
  password,
  privateKeyContent,
  passphrase,
  sshCompatPreset,
  onStatusChange,
  onConnected,
  onDisconnected,
}: SshPaneProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const statusRef = useRef<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;
  // cleanupRef: roda quando a conexão precisa ser encerrada (após connect() finalizar)
  const cleanupRef = useRef<(() => void) | null>(null);
  // cancelRef: cancela um connect() ainda em andamento (antes de cleanupRef estar pronto)
  const cancelRef = useRef<(() => void) | null>(null);
  const terminalSettings = useSettingsStore((s) => s.settings.terminal);
  const sshSettings = useSettingsStore((s) => s.settings.ssh);
  const appendTerminalOutput = useSessionsStore((s) => s.appendTerminalOutput);
  const [pendingFingerprint, setPendingFingerprint] = useState<string | null>(null);

  const clearConnectionBindings = useCallback(() => {
    cancelRef.current?.();
    cleanupRef.current?.();
    cancelRef.current = null;
    cleanupRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!termRef.current) return;

    // Uma nova tentativa de conexão (ex.: após confiar na fingerprint)
    // precisa remover listeners/handlers anteriores para não duplicar input.
    clearConnectionBindings();

    // Registra canceller imediatamente (antes de qualquer await) para que o
    // cleanup do useEffect consiga abortar mesmo que connect() ainda esteja
    // aguardando os listen() resolverem (problema do React StrictMode).
    let cancelled = false;
    cancelRef.current = () => { cancelled = true; };

    let xterm = xtermRef.current;
    if (!xterm) {
      xterm = new Terminal({
        fontFamily: terminalSettings.fontFamily
          ? `"${terminalSettings.fontFamily}", monospace`
          : "monospace",
        fontSize: terminalSettings.fontSize,
        cursorStyle: terminalSettings.cursorStyle,
        cursorBlink: terminalSettings.cursorBlink,
        scrollback: terminalSettings.scrollback,
        theme: {
          background: getComputedStyle(document.documentElement).getPropertyValue("--terminal-bg").trim() || "#0d1117",
          foreground: getComputedStyle(document.documentElement).getPropertyValue("--terminal-fg").trim() || "#c9d1d9",
          cursor: getComputedStyle(document.documentElement).getPropertyValue("--terminal-cursor").trim() || "#58a6ff",
          selectionBackground: getComputedStyle(document.documentElement).getPropertyValue("--terminal-selection").trim() || "#264f78",
        },
        allowTransparency: true,
      });
      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.loadAddon(new WebLinksAddon());
      xterm.open(termRef.current);
      fitAddon.fit();
      xtermRef.current = xterm;
      fitRef.current = fitAddon;

      // Permite que AltGr (reportado como Ctrl+Alt no X11/WebKit) e teclas mortas
      // (dead keys para ç, ~, ´, etc.) sejam compostas pelo browser antes de chegar
      // ao onData — sem isso, xterm intercepta o keydown e impede a composição.
      xterm.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
        if (ev.getModifierState("AltGraph") || (ev.altKey && ev.ctrlKey)) return false;
        return true;
      });
    }

    for (const chunk of useSessionsStore.getState().terminalSnapshots[paneId]?.outputBase64Chunks ?? []) {
      writeBase64Chunk(xtermRef.current, chunk);
    }

    const fitAddon = fitRef.current!;
    const dims = fitAddon.proposeDimensions() ?? { cols: 80, rows: 24 };

    const dataDispose = xterm.onData((data) => {
      invoke("ssh_send_input", { tabId: paneId, data }).catch(() => {});
    });

    let wasConnected = false;
    const registered: UnlistenFn[] = [];

    const ul1 = await listen<SshOutputEvent>("ssh-output", (event) => {
      if (event.payload.tab_id !== paneId) return;
      writeBase64Chunk(xtermRef.current, event.payload.data);
      appendTerminalOutput(paneId, event.payload.data);
    });
    if (cancelled) { ul1(); dataDispose.dispose(); return; }
    registered.push(ul1);

    const ul2 = await listen<SshStatusEvent>("ssh-status", (event) => {
      if (event.payload.tab_id !== paneId) return;
      const s = event.payload.status;
      statusRef.current = s;
      onStatusChange(paneId, s);
      if (s === "connected") {
        wasConnected = true;
        onConnected();
        // Captura o foco do teclado assim que a sessão estiver pronta
        xtermRef.current?.focus();
      }
      if (s === "disconnected" || s === "error") {
        onDisconnectedRef.current?.(s);
      }
    });
    if (cancelled) { ul2(); dataDispose.dispose(); registered.forEach((f) => f()); return; }
    registered.push(ul2);

    const sessionExists = await invoke<boolean>("ssh_session_exists", { tabId: paneId });
    if (cancelled) {
      dataDispose.dispose();
      registered.forEach((dispose) => dispose());
      return;
    }

    if (sessionExists) {
      statusRef.current = "connected";
      onStatusChange(paneId, "connected");
      xtermRef.current?.focus();
    } else {
      invoke("ssh_connect", {
      tabId: paneId,
      host,
      port,
      username,
      authMethod,
      password,
      privateKeyContent,
      privateKeyPassphrase: passphrase,
      sshCompatPreset: sshCompatPreset ?? "modern",
      keepaliveInterval: sshSettings?.keepAliveInterval ?? 60,
      connectionTimeout: sshSettings?.inactivityTimeout ?? 0,
      cols: dims.cols ?? 80,
      rows: dims.rows ?? 24,
      }).catch((err: string) => {
        if (cancelled) return;
        // Host desconhecido: pede confirmação de fingerprint antes de prosseguir
        if (typeof err === "string" && err.startsWith("HOST_KEY_UNKNOWN:")) {
          const fingerprint = err.slice("HOST_KEY_UNKNOWN:".length);
          setPendingFingerprint(fingerprint);
          return;
        }
        xtermRef.current?.writeln(`\r\n\x1b[1;31mErro: ${err}\x1b[0m\r\n`);
        onStatusChange(paneId, "error");
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const d = fitAddon.proposeDimensions();
      if (d) invoke("ssh_resize", { tabId: paneId, cols: d.cols, rows: d.rows }).catch(() => {});
    });
    if (termRef.current) resizeObserver.observe(termRef.current);

    // Guarda o cleanup no ref (não em termRef.current, pois React zera refs antes
    // de chamar o cleanup do useEffect, o que causava leak de listeners).
    if (!termRef.current) return;
    cleanupRef.current = () => {
      cancelled = true;
      registered.forEach((f) => f());
      resizeObserver.disconnect();
      dataDispose.dispose();
    };

    void wasConnected; // suppress unused warning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendTerminalOutput, clearConnectionBindings, paneId]);

  const handleTrustHost = useCallback(async (accepted: boolean) => {
    if (!pendingFingerprint) return;
    if (!accepted) {
      setPendingFingerprint(null);
      onStatusChange(paneId, "error");
      onDisconnectedRef.current?.("error");
      return;
    }
    try {
      await invoke("ssh_trust_host", { host, port, fingerprint: pendingFingerprint });
    } catch {
      // ignora erro ao salvar — a conexão prossegue
    }
    setPendingFingerprint(null);
    connect();
  }, [pendingFingerprint, host, port, paneId, onStatusChange, connect]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      void invoke("ssh_disconnect", { tabId: paneId }).catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [paneId]);

  useEffect(() => {
    connect();
    return () => {
      // cancelRef para abortar connect() que ainda esteja aguardando listen() resolver.
      // cleanupRef para encerrar uma conexão já estabelecida.
      clearConnectionBindings();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearConnectionBindings, paneId]);

  return (
    <div className="relative h-full w-full" style={{ backgroundColor: "var(--terminal-bg)" }}>
      <div ref={termRef} className="h-full w-full" />

      {pendingFingerprint && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-[var(--text-primary)]">Host desconhecido</p>
              <p className="text-sm text-[var(--text-muted)]">
                Esta é a primeira conexão com <span className="font-medium text-[var(--text-primary)]">{host}:{port}</span>.
                Verifique a fingerprint abaixo antes de continuar.
              </p>
            </div>
            <div className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-4 py-3">
              <p className="text-xs text-[var(--text-muted)] mb-1">Fingerprint (SHA-256)</p>
              <p className="font-mono text-xs text-[var(--text-primary)] break-all select-all">{pendingFingerprint}</p>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Se você não consegue verificar esta fingerprint com o administrador do servidor, recuse a conexão.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleTrustHost(false)}
                className="px-4 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Recusar
              </button>
              <button
                onClick={() => handleTrustHost(true)}
                className="px-4 py-2 rounded-lg text-sm bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                Confiar e conectar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
