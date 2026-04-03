import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/store/settings";

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

  const connect = useCallback(async () => {
    if (!termRef.current) return;

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

    const fitAddon = fitRef.current!;
    const dims = fitAddon.proposeDimensions() ?? { cols: 80, rows: 24 };

    const dataDispose = xterm.onData((data) => {
      invoke("ssh_send_input", { tabId: paneId, data }).catch(() => {});
    });

    let wasConnected = false;
    const registered: UnlistenFn[] = [];

    const ul1 = await listen<SshOutputEvent>("ssh-output", (event) => {
      if (event.payload.tab_id !== paneId) return;
      try {
        const bytes = Uint8Array.from(atob(event.payload.data), (c) => c.charCodeAt(0));
        xtermRef.current?.write(bytes);
      } catch {
        xtermRef.current?.write(event.payload.data);
      }
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
      if (!cancelled) {
        xtermRef.current?.writeln(`\r\n\x1b[1;31mErro: ${err}\x1b[0m\r\n`);
        onStatusChange(paneId, "error");
      }
    });

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
      invoke("ssh_disconnect", { tabId: paneId }).catch(() => {});
    };

    void wasConnected; // suppress unused warning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  useEffect(() => {
    connect();
    return () => {
      // cancelRef para abortar connect() que ainda esteja aguardando listen() resolver.
      // cleanupRef para encerrar uma conexão já estabelecida.
      cancelRef.current?.();
      cleanupRef.current?.();
      cancelRef.current = null;
      cleanupRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  return (
    <div className="relative h-full w-full" style={{ backgroundColor: "var(--terminal-bg)" }}>
      <div ref={termRef} className="h-full w-full" />
    </div>
  );
}
