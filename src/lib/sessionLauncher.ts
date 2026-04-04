import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { v4 as uuidv4 } from "uuid";
import { AppSettings, SessionConnection } from "@/types";
import { buildSessionRoute } from "@/lib/windowMode";
import { notify } from "@/lib/notifications";

interface LaunchTerminalSessionParams {
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  openMode: AppSettings["terminal"]["sessionOpenMode"];
  openSession: (hostId: string, hostLabel: string, hostAddress: string) => string;
  standaloneWindow?: boolean;
}

interface LaunchQuickConnectSessionParams {
  connection: SessionConnection;
  hostLabel: string;
  hostAddress: string;
  openMode: AppSettings["terminal"]["sessionOpenMode"];
  openQuickConnectSession: (connection: SessionConnection, hostLabel: string, hostAddress: string) => string;
  standaloneWindow?: boolean;
}

async function createStandaloneTerminalWindow(route: string, hostLabel: string, sessionId: string): Promise<boolean> {
  // Uma URL relativa ("/terminal/abc123?...") não tem contexto de base no WebKit/WebView2
  // e resulta em janela em branco. Prefixar com window.location.origin resolve
  // corretamente tanto em dev (http://localhost:1420) quanto em prod (tauri://localhost).
  const absoluteUrl = `${window.location.origin}${route}`;
  const webview = new WebviewWindow(`ssh-session-${sessionId}`, {
    url: absoluteUrl,
    title: `SSH Vault - ${hostLabel}`,
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    focus: true,
  });

  return new Promise<boolean>((resolve) => {
    void webview.once("tauri://created", () => resolve(true));
    void webview.once("tauri://error", () => resolve(false));
  });
}

export async function launchTerminalSession({
  hostId,
  hostLabel,
  hostAddress,
  openMode,
  openSession,
  standaloneWindow = false,
}: LaunchTerminalSessionParams): Promise<string | null> {
  if (openMode === "window") {
    const sessionId = uuidv4();
    const route = buildSessionRoute("terminal", sessionId, {
      standalone: true,
      hostId,
      hostLabel,
      hostAddress,
    });

    const opened = await createStandaloneTerminalWindow(route, hostLabel, sessionId);
    if (opened) return null;

    // Fallback: janela não pôde ser criada (ex: restrição do Wayland ou permissão ausente).
    // Abre a sessão em aba no lugar.
    notify("SSH Vault", `Não foi possível abrir janela separada para ${hostLabel}. Abrindo em aba.`);
  }

  const sessionId = openSession(hostId, hostLabel, hostAddress);
  return buildSessionRoute("terminal", sessionId, {
    standalone: standaloneWindow,
    hostId: standaloneWindow ? hostId : undefined,
    hostLabel: standaloneWindow ? hostLabel : undefined,
    hostAddress: standaloneWindow ? hostAddress : undefined,
  });
}

export async function launchQuickConnectSession({
  connection,
  hostLabel,
  hostAddress,
  openMode,
  openQuickConnectSession,
  standaloneWindow = false,
}: LaunchQuickConnectSessionParams): Promise<string | null> {
  if (openMode === "window") {
    const sessionId = uuidv4();
    const route = buildSessionRoute("terminal", sessionId, {
      standalone: true,
      hostId: `quick-connect:${sessionId}`,
      hostLabel,
      hostAddress,
      quickConnect: true,
      connectionHost: connection.host,
      connectionPort: connection.port,
      connectionUsername: connection.username,
      connectionAuthMethod: connection.authMethod,
    });

    const opened = await createStandaloneTerminalWindow(route, hostLabel, sessionId);
    if (opened) return null;

    notify("SSH Vault", `Nao foi possivel abrir janela separada para ${hostLabel}. Abrindo em aba.`);
  }

  const sessionId = openQuickConnectSession(connection, hostLabel, hostAddress);
  return buildSessionRoute("terminal", sessionId, {
    standalone: standaloneWindow,
    hostId: standaloneWindow ? `quick-connect:${sessionId}` : undefined,
    hostLabel: standaloneWindow ? hostLabel : undefined,
    hostAddress: standaloneWindow ? hostAddress : undefined,
    quickConnect: standaloneWindow,
    connectionHost: standaloneWindow ? connection.host : undefined,
    connectionPort: standaloneWindow ? connection.port : undefined,
    connectionUsername: standaloneWindow ? connection.username : undefined,
    connectionAuthMethod: standaloneWindow ? connection.authMethod : undefined,
  });
}
