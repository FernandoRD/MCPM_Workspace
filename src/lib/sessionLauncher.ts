import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { v4 as uuidv4 } from "uuid";
import { AppSettings, SessionConnection } from "@/types";
import i18n from "@/lib/i18n";
import { buildSessionRoute } from "@/lib/windowMode";
import { notify } from "@/lib/notifications";
import { APP_NAME } from "@/lib/appInfo";
import { sanitizeSessionConnection } from "@/lib/inputSanitizers";

interface SystemTerminalConnection {
  protocol: "ssh" | "telnet";
  host: string;
  port: number;
  username: string;
  authMethod: string;
  privateKeyContent?: string | null;
  privateKeyPassphrase?: string | null;
}

interface LaunchTerminalSessionParams {
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  openMode: AppSettings["terminal"]["sessionOpenMode"];
  openSession: (hostId: string, hostLabel: string, hostAddress: string) => string;
  standaloneWindow?: boolean;
  /** Obrigatório quando openMode === "system-terminal" */
  systemTerminalConnection?: SystemTerminalConnection;
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
    type?: "terminal" | "rdp" | "vnc"
  ) => string;
  sessionType?: "terminal" | "rdp" | "vnc";
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

interface LaunchVncSessionParams {
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  openMode: AppSettings["terminal"]["sessionOpenMode"];
  openVncTab: (hostId: string, hostLabel: string, hostAddress: string) => string;
  standaloneWindow?: boolean;
}

async function createStandaloneSessionWindow(
  route: string,
  hostLabel: string,
  sessionId: string,
  kind: "terminal" | "rdp" | "vnc"
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
  systemTerminalConnection,
}: LaunchTerminalSessionParams): Promise<string | null> {
  if (openMode === "window") {
    if (!systemTerminalConnection) {
      notify(APP_NAME, `Não foi possível abrir terminal externo para ${hostLabel}: dados de conexão ausentes.`);
      return null;
    }
    try {
      await invoke("ssh_launch_system_terminal", {
        protocol: systemTerminalConnection.protocol,
        host: systemTerminalConnection.host,
        port: systemTerminalConnection.port,
        username: systemTerminalConnection.username,
        authMethod: systemTerminalConnection.authMethod,
        privateKeyContent: systemTerminalConnection.privateKeyContent ?? null,
        privateKeyPassphrase: systemTerminalConnection.privateKeyPassphrase ?? null,
      });
    } catch (err) {
      notify(APP_NAME, `Erro ao abrir terminal externo para ${hostLabel}: ${err}`);
    }
    return null;
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

  // Para sessões de terminal em modo janela separada: usa o terminal do sistema
  // em vez de abrir uma WebviewWindow com a app completa.
  if (openMode === "window" && sessionType === "terminal") {
    try {
      await invoke("ssh_launch_system_terminal", {
        protocol: sanitizedConnection.protocol === "telnet" ? "telnet" : "ssh",
        host: sanitizedConnection.host,
        port: sanitizedConnection.port,
        username: sanitizedConnection.username,
        authMethod: sanitizedConnection.authMethod,
        privateKeyContent: sanitizedConnection.privateKeyContent ?? null,
        privateKeyPassphrase: sanitizedConnection.passphrase ?? null,
      });
    } catch (err) {
      notify(APP_NAME, `Erro ao abrir terminal externo: ${err}`);
    }
    return null;
  }

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

    const opened = await createStandaloneSessionWindow(route, i18n.t("nav.quickConnect"), sessionId, sessionType);
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

export async function launchVncSession({
  hostId,
  hostLabel,
  hostAddress,
  openMode,
  openVncTab,
  standaloneWindow = false,
}: LaunchVncSessionParams): Promise<string | null> {
  if (openMode === "window") {
    const sessionId = uuidv4();
    const route = buildSessionRoute("vnc", sessionId, {
      standalone: true,
      hostId,
      hostLabel,
      hostAddress,
    });

    const opened = await createStandaloneSessionWindow(route, hostLabel, sessionId, "vnc");
    if (opened) return null;

    notify(APP_NAME, `Não foi possível abrir janela separada para ${hostLabel}. Abrindo em aba.`);
  }

  const sessionId = openVncTab(hostId, hostLabel, hostAddress);
  return buildSessionRoute("vnc", sessionId, {
    standalone: standaloneWindow,
    hostId: standaloneWindow ? hostId : undefined,
    hostLabel: standaloneWindow ? hostLabel : undefined,
    hostAddress: standaloneWindow ? hostAddress : undefined,
  });
}
