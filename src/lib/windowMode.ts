import { TabType } from "@/types";

export interface SessionRouteOptions {
  standalone?: boolean;
  hostId?: string;
  hostLabel?: string;
  hostAddress?: string;
  quickConnect?: boolean;
  connectionHost?: string;
  connectionPort?: number;
  connectionUsername?: string;
  connectionAuthMethod?: string;
}

export interface SessionBootstrapParams {
  standalone: boolean;
  hostId?: string;
  hostLabel?: string;
  hostAddress?: string;
  quickConnect: boolean;
  connectionHost?: string;
  connectionPort?: number;
  connectionUsername?: string;
  connectionAuthMethod?: string;
}

export function isStandaloneWindow(search: string): boolean {
  return new URLSearchParams(search).get("standalone") === "1";
}

export function withStandaloneQuery(path: string, standalone: boolean): string {
  if (!standalone) return path;

  const [pathname, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  params.set("standalone", "1");

  return `${pathname}?${params.toString()}`;
}

export function buildAppRoute(path: string, standalone: boolean): string {
  return withStandaloneQuery(path, standalone);
}

export function buildSessionRoute(
  type: TabType,
  sessionId: string,
  options: SessionRouteOptions = {}
): string {
  const basePath = type === "sftp" ? `/sftp/${sessionId}` : `/terminal/${sessionId}`;
  const params = new URLSearchParams();

  if (options.standalone) params.set("standalone", "1");
  if (options.hostId) params.set("hostId", options.hostId);
  if (options.hostLabel) params.set("hostLabel", options.hostLabel);
  if (options.hostAddress) params.set("hostAddress", options.hostAddress);
  if (options.quickConnect) params.set("quickConnect", "1");
  if (options.connectionHost) params.set("connectionHost", options.connectionHost);
  if (typeof options.connectionPort === "number") params.set("connectionPort", String(options.connectionPort));
  if (options.connectionUsername) params.set("connectionUsername", options.connectionUsername);
  if (options.connectionAuthMethod) params.set("connectionAuthMethod", options.connectionAuthMethod);

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function readSessionBootstrap(search: string): SessionBootstrapParams {
  const params = new URLSearchParams(search);

  return {
    standalone: params.get("standalone") === "1",
    hostId: params.get("hostId") ?? undefined,
    hostLabel: params.get("hostLabel") ?? undefined,
    hostAddress: params.get("hostAddress") ?? undefined,
    quickConnect: params.get("quickConnect") === "1",
    connectionHost: params.get("connectionHost") ?? undefined,
    connectionPort: params.get("connectionPort") ? Number(params.get("connectionPort")) : undefined,
    connectionUsername: params.get("connectionUsername") ?? undefined,
    connectionAuthMethod: params.get("connectionAuthMethod") ?? undefined,
  };
}
