import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { WifiOff, RotateCcw } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useSessionsStore } from "@/store/sessions";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/Button";

export function TerminalPage() {
  const { t } = useTranslation();
  const { tabId } = useParams<{ tabId: string }>();
  const navigate = useNavigate();
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const tabs = useSessionsStore((s) => s.tabs);
  const updateTabStatus = useSessionsStore((s) => s.updateTabStatus);
  const getHost = useHostsStore((s) => s.getHost);
  const setLastConnected = useHostsStore((s) => s.setLastConnected);
  const terminalSettings = useSettingsStore((s) => s.settings.terminal);

  const tab = tabs.find((t) => t.id === tabId);
  const host = tab ? getHost(tab.hostId) : undefined;

  useEffect(() => {
    if (!termRef.current || !tab) return;

    const xterm = new Terminal({
      fontFamily: terminalSettings.fontFamily || "JetBrains Mono, monospace",
      fontSize: terminalSettings.fontSize,
      cursorStyle: terminalSettings.cursorStyle,
      cursorBlink: terminalSettings.cursorBlink,
      scrollback: terminalSettings.scrollback,
      theme: {
        background: "var(--terminal-bg)" in document.documentElement.style
          ? getComputedStyle(document.documentElement).getPropertyValue("--terminal-bg").trim()
          : "#0d1117",
        foreground: getComputedStyle(document.documentElement).getPropertyValue("--terminal-fg").trim() || "#c9d1d9",
        cursor: getComputedStyle(document.documentElement).getPropertyValue("--terminal-cursor").trim() || "#58a6ff",
        selectionBackground: getComputedStyle(document.documentElement).getPropertyValue("--terminal-selection").trim() || "#264f78",
      },
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    const linksAddon = new WebLinksAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(linksAddon);
    xterm.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitRef.current = fitAddon;

    // Simulate connection message (SSH real será na Fase 2)
    updateTabStatus(tab.id, "connected");
    if (host) setLastConnected(host.id);

    xterm.writeln(`\x1b[1;32mSSH Vault\x1b[0m — Sessão demo`);
    xterm.writeln(`\x1b[90mConectando a \x1b[0;36m${tab.hostAddress}\x1b[90m...\x1b[0m`);
    xterm.writeln(`\x1b[90m(Sessão SSH real será implementada na Fase 2)\x1b[0m`);
    xterm.writeln("");
    xterm.write(`\x1b[1;32m${host?.username ?? "user"}@${host?.host ?? "host"}\x1b[0m:\x1b[1;34m~\x1b[0m$ `);

    xterm.onKey(({ key, domEvent }) => {
      if (domEvent.key === "Enter") {
        xterm.writeln("");
        xterm.write(`\x1b[1;32m${host?.username ?? "user"}@${host?.host ?? "host"}\x1b[0m:\x1b[1;34m~\x1b[0m$ `);
      } else if (domEvent.key === "Backspace") {
        xterm.write("\b \b");
      } else {
        xterm.write(key);
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      xterm.dispose();
    };
  }, [tabId]);

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
        <Button onClick={() => {}}>
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
