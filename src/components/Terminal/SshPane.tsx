import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { WifiOff, RotateCcw } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/Button";

interface SshPaneProps {
  paneId: string;
  host: string;
  port: number;
  authMethod: string;
  username: string;
  password: string | null;
  privateKeyContent: string | null;
  passphrase: string | null;
  onStatusChange: (paneId: string, status: "connecting" | "connected" | "disconnected" | "error") => void;
  onConnected: () => void;
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
  onStatusChange,
  onConnected,
}: SshPaneProps) {
  const { t } = useTranslation();
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const statusRef = useRef<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [overlayStatus, setOverlayStatus] = useState<"idle" | "disconnected" | "error">("idle");
  // cleanupRef: roda quando a conexão precisa ser encerrada (após connect() finalizar)
  const cleanupRef = useRef<(() => void) | null>(null);
  // cancelRef: cancela um connect() ainda em andamento (antes de cleanupRef estar pronto)
  const cancelRef = useRef<(() => void) | null>(null);
  const terminalSettings = useSettingsStore((s) => s.settings.terminal);

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
      if (s === "disconnected" || s === "error") setOverlayStatus(s);
      else setOverlayStatus("idle");
      onStatusChange(paneId, s);
      if (s === "connected") {
        wasConnected = true;
        onConnected();
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
      cols: dims.cols ?? 80,
      rows: dims.rows ?? 24,
    }).catch((err: string) => {
      if (!cancelled) {
        xtermRef.current?.writeln(`\r\n\x1b[1;31mErro: ${err}\x1b[0m\r\n`);
        setOverlayStatus("error");
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

  const handleReconnect = () => {
    cancelRef.current?.();
    cleanupRef.current?.();
    cancelRef.current = null;
    cleanupRef.current = null;
    statusRef.current = "connecting";
    setOverlayStatus("idle");
    onStatusChange(paneId, "connecting");
    xtermRef.current?.clear();
    connect();
  };

  return (
    <div className="relative h-full w-full" style={{ backgroundColor: "var(--terminal-bg)" }}>
      {/* Terminal div is always mounted so termRef stays valid for reconnect */}
      <div ref={termRef} className="h-full w-full" />
      {(overlayStatus === "disconnected" || overlayStatus === "error") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg-primary)]">
          <WifiOff size={28} className="text-[var(--danger)]" />
          <p className="text-sm text-[var(--text-primary)]">{t("terminal.disconnected")}</p>
          <Button size="sm" onClick={handleReconnect}>
            <RotateCcw size={13} />
            {t("terminal.reconnect")}
          </Button>
        </div>
      )}
    </div>
  );
}
