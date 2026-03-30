import { useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { WifiOff, RotateCcw } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useSessionsStore } from "@/store/sessions";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { useCredentialsStore } from "@/store/credentials";
import { Button } from "@/components/ui/Button";

interface SshOutputEvent {
  tab_id: string;
  data: string; // base64
}

interface SshStatusEvent {
  tab_id: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  message?: string;
}

export function TerminalPage() {
  const { t } = useTranslation();
  const { tabId } = useParams<{ tabId: string }>();
  const navigate = useNavigate();

  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const tabs = useSessionsStore((s) => s.tabs);
  const updateTabStatus = useSessionsStore((s) => s.updateTabStatus);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const openSession = useSessionsStore((s) => s.openSession);
  const getHost = useHostsStore((s) => s.getHost);
  const setLastConnected = useHostsStore((s) => s.setLastConnected);
  const terminalSettings = useSettingsStore((s) => s.settings.terminal);
  const getCredential = useCredentialsStore((s) => s.getCredential);

  const tab = tabs.find((t) => t.id === tabId);
  const host = tab ? getHost(tab.hostId) : undefined;

  const handleReconnect = useCallback(() => {
    if (!host) return;
    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = credential?.username ?? host.username ?? "";
    const newTabId = openSession(host.id, host.label, username ? `${username}@${host.host}` : host.host);
    navigate(`/terminal/${newTabId}`, { replace: true });
  }, [host, openSession, navigate, getCredential]);

  useEffect(() => {
    if (!termRef.current || !tab || !host) return;

    const xterm = new Terminal({
      fontFamily: terminalSettings.fontFamily
        ? `"${terminalSettings.fontFamily}", monospace`
        : "monospace",
      fontSize: terminalSettings.fontSize,
      cursorStyle: terminalSettings.cursorStyle,
      cursorBlink: terminalSettings.cursorBlink,
      scrollback: terminalSettings.scrollback,
      theme: {
        background:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--terminal-bg")
            .trim() || "#0d1117",
        foreground:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--terminal-fg")
            .trim() || "#c9d1d9",
        cursor:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--terminal-cursor")
            .trim() || "#58a6ff",
        selectionBackground:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--terminal-selection")
            .trim() || "#264f78",
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

    const dataDispose = xterm.onData((data) => {
      invoke("ssh_send_input", { tabId: tab.id, data }).catch(() => {});
    });

    // `cancelled` é definido para true pelo cleanup do useEffect.
    // Cada `await listen()` checa se foi cancelado e, se sim, chama
    // unlisten imediatamente — garantindo que nunca fique listener órfão.
    let cancelled = false;
    let wasConnected = false;
    const registered: UnlistenFn[] = [];

    const setup = async () => {
      // ── Registra listeners ANTES de conectar para não perder eventos ──
      const ul1 = await listen<SshOutputEvent>("ssh-output", (event) => {
        if (event.payload.tab_id !== tab.id) return;
        try {
          const bytes = Uint8Array.from(atob(event.payload.data), (c) =>
            c.charCodeAt(0)
          );
          xtermRef.current?.write(bytes);
        } catch {
          xtermRef.current?.write(event.payload.data);
        }
      });
      if (cancelled) { ul1(); return; }
      registered.push(ul1);

      const ul2 = await listen<SshStatusEvent>("ssh-status", (event) => {
        if (event.payload.tab_id !== tab.id) return;
        updateTabStatus(tab.id, event.payload.status);
        if (event.payload.status === "connected") {
          wasConnected = true;
          setLastConnected(host.id);
        }
        if (event.payload.status === "disconnected" && wasConnected && !cancelled) {
          cancelled = true;
          closeSession(tab.id);
          navigate("/");
        }
      });
      if (cancelled) { ul2(); return; }
      registered.push(ul2);

      // ── Agora é seguro conectar ──
      const dims = fitAddon.proposeDimensions() ?? { cols: 80, rows: 24 };
      const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
      const authMethod = credential?.authMethod ?? host.authMethod ?? "password";
      const username = credential?.username ?? host.username ?? "";
      const password = credential?.password ?? host.passwordRef ?? null;
      const privateKeyPath = credential?.privateKeyPath ?? host.privateKeyPath ?? null;
      const passphrase = credential?.passphrase ?? host.passphrase ?? null;
      invoke("ssh_connect", {
        tabId: tab.id,
        host: host.host,
        port: host.port,
        username,
        authMethod,
        password,
        privateKeyPath,
        privateKeyPassphrase: passphrase,
        cols: dims.cols ?? 80,
        rows: dims.rows ?? 24,
      }).catch((err: string) => {
        xtermRef.current?.writeln(`\r\n\x1b[1;31mErro: ${err}\x1b[0m\r\n`);
        updateTabStatus(tab.id, "error");
      });
    };

    setup();

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        invoke("ssh_resize", {
          tabId: tab.id,
          cols: dims.cols,
          rows: dims.rows,
        }).catch(() => {});
      }
    });
    resizeObserver.observe(termRef.current);

    return () => {
      cancelled = true;
      registered.forEach((fn) => fn()); // cancela todos os listeners já registrados
      resizeObserver.disconnect();
      dataDispose.dispose();
      invoke("ssh_disconnect", { tabId: tab.id }).catch(() => {});
      xterm.dispose();
    };
  }, [tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tab) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">Sessão não encontrada</p>
        <Button onClick={() => navigate("/")}>Voltar</Button>
      </div>
    );
  }

  if (tab.status === "disconnected" || tab.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--danger)]" />
        <p className="text-[var(--text-primary)]">{t("terminal.disconnected")}</p>
        <Button onClick={handleReconnect}>
          <RotateCcw size={14} />
          {t("terminal.reconnect")}
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={termRef}
      className="h-full w-full"
      style={{ backgroundColor: "var(--terminal-bg)" }}
    />
  );
}
