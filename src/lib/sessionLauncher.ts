import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { v4 as uuidv4 } from "uuid";
import { AppSettings, SessionConnection } from "@/types";
import { buildSessionRoute } from "@/lib/windowMode";
import { notify } from "@/lib/notifications";
import { APP_NAME } from "@/lib/appInfo";
import { sanitizeSessionConnection } from "@/lib/inputSanitizers";

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
  openQuickConnectSession: (
    connection: SessionConnection,
    hostLabel: string,
    hostAddress: string,
    type?: "terminal" | "rdp"
  ) => string;
  sessionType?: "terminal" | "rdp";
  standaloneWindow?: boolean;
}

interface LaunchRdpSessionParams {
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  openMode: AppSettings["terminal"]["sessionOpenMode"];
  openRdpTab: (hostId: string, hostLabel: string, hostAddress: string) => string;
  standaloneWindow?: boolean;
}

async function createStandaloneSessionWindow(
  route: string,
  hostLabel: string,
  sessionId: string,
  kind: "terminal" | "rdp"
): Promise<boolean> {
  // Uma URL relativa ("/terminal/abc123?...") não tem contexto de base no WebKit/WebView2
  // e resulta em janela em branco. Prefixar com window.location.origin resolve
  // corretamente tanto em dev (http://localhost:1420) quanto em prod (tauri://localhost).
  const absoluteUrl = `${window.location.origin}${route}`;
  const webview = new WebviewWindow(`${kind}-session-${sessionId}`, {
    url: absoluteUrl,
    title: `${APP_NAME} - ${hostLabel}`,
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

async function storeQuickConnectBootstrap(
  bootstrapId: string,
  connection: SessionConnection,
  hostId: string,
  hostLabel: string,
  hostAddress: string,
): Promise<void> {
  const sanitizedConnection = sanitizeSessionConnection(connection);
  await invoke("store_quick_connect_bootstrap", {
    bootstrapId,
    payload: {
      host_id: hostId,
      host_label: hostLabel,
      host_address: hostAddress,
      connection_protocol: sanitizedConnection.protocol,
      connection_host: sanitizedConnection.host,
      connection_port: sanitizedConnection.port,
      connection_username: sanitizedConnection.username,
      connection_auth_method: sanitizedConnection.authMethod,
      connection_password: sanitizedConnection.password ?? null,
      connection_private_key_content: sanitizedConnection.privateKeyContent ?? null,
      connection_passphrase: sanitizedConnection.passphrase ?? null,
    },
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

    const opened = await createStandaloneSessionWindow(route, hostLabel, sessionId, "terminal");
    if (opened) return null;

    // Fallback: janela não pôde ser criada (ex: restrição do Wayland ou permissão ausente).
    // Abre a sessão em aba no lugar.
    notify(APP_NAME, `Não foi possível abrir janela separada para ${hostLabel}. Abrindo em aba.`);
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
  sessionType = "terminal",
  standaloneWindow = false,
}: LaunchQuickConnectSessionParams): Promise<string | null> {
  const sanitizedConnection = sanitizeSessionConnection(connection);
  const needsBootstrap = openMode === "window" || standaloneWindow;
  const bootstrapId = needsBootstrap ? uuidv4() : undefined;

  if (bootstrapId) {
    const quickConnectHostId = `quick-connect:${bootstrapId}`;

    await storeQuickConnectBootstrap(
      bootstrapId,
      { ...sanitizedConnection, bootstrapId },
      quickConnectHostId,
      hostLabel,
      hostAddress,
    );
  }

  if (openMode === "window") {
    const sessionId = uuidv4();
    const route = buildSessionRoute(sessionType, sessionId, {
      standalone: true,
      quickConnect: true,
      quickConnectBootstrapId: bootstrapId,
    });

    const opened = await createStandaloneSessionWindow(route, "Quick Connect", sessionId, sessionType);
    if (opened) return null;

    notify(APP_NAME, `Nao foi possivel abrir janela separada para ${hostLabel}. Abrindo em aba.`);
  }

  const sessionId = openQuickConnectSession(
    { ...sanitizedConnection, bootstrapId },
    hostLabel,
    hostAddress,
    sessionType
  );
  return buildSessionRoute(sessionType, sessionId, {
    standalone: standaloneWindow,
    quickConnect: standaloneWindow,
    quickConnectBootstrapId: standaloneWindow ? bootstrapId : undefined,
  });
}

export async function launchRdpSession({
  hostId,
  hostLabel,
  hostAddress,
  openMode,
  openRdpTab,
  standaloneWindow = false,
}: LaunchRdpSessionParams): Promise<string | null> {
  if (openMode === "window") {
    const sessionId = uuidv4();
    const route = buildSessionRoute("rdp", sessionId, {
      standalone: true,
      hostId,
      hostLabel,
      hostAddress,
    });

    const opened = await createStandaloneSessionWindow(route, hostLabel, sessionId, "rdp");
    if (opened) return null;

    notify(APP_NAME, `Não foi possível abrir janela separada para ${hostLabel}. Abrindo em aba.`);
  }

  const sessionId = openRdpTab(hostId, hostLabel, hostAddress);
  return buildSessionRoute("rdp", sessionId, {
    standalone: standaloneWindow,
    hostId: standaloneWindow ? hostId : undefined,
    hostLabel: standaloneWindow ? hostLabel : undefined,
    hostAddress: standaloneWindow ? hostAddress : undefined,
  });
}
