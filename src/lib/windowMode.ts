import { TabType } from "@/types";

export interface SessionRouteOptions {
  standalone?: boolean;
  hostId?: string;
  hostLabel?: string;
  hostAddress?: string;
  quickConnect?: boolean;
  quickConnectBootstrapId?: string;
}

export interface SessionBootstrapParams {
  standalone: boolean;
  hostId?: string;
  hostLabel?: string;
  hostAddress?: string;
  quickConnect: boolean;
  quickConnectBootstrapId?: string;
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
  const basePath =
    type === "sftp" ? `/sftp/${sessionId}` : type === "rdp" ? `/rdp/${sessionId}` : `/terminal/${sessionId}`;
  const params = new URLSearchParams();

  if (options.standalone) params.set("standalone", "1");
  if (options.hostId) params.set("hostId", options.hostId);
  if (options.hostLabel) params.set("hostLabel", options.hostLabel);
  if (options.hostAddress) params.set("hostAddress", options.hostAddress);
  if (options.quickConnect) params.set("quickConnect", "1");
  if (options.quickConnectBootstrapId) params.set("quickConnectBootstrapId", options.quickConnectBootstrapId);

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
    quickConnectBootstrapId: params.get("quickConnectBootstrapId") ?? undefined,
  };
}
