import type { SessionTab, SplitDirection, TabType, TerminalPaneState } from "@/types";

/** Chave versionada para que alterações futuras não precisem confiar no formato antigo. */
export const SESSION_PERSISTENCE_KEY = "ssh-vault-open-sessions";
export const SESSION_PERSISTENCE_VERSION = 1;

export interface PersistedSessionTab {
  id: string;
  type: TabType;
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  panes: Array<Pick<TerminalPaneState, "id">>;
  splitDirection: SplitDirection;
  createdAt: string;
}

export interface PersistedSessionState {
  version: typeof SESSION_PERSISTENCE_VERSION;
  tabs: PersistedSessionTab[];
  activeTabId: string | null;
}

const TAB_TYPES: TabType[] = ["terminal", "sftp", "rdp", "vnc"];
const SPLIT_DIRECTIONS: SplitDirection[] = ["horizontal", "vertical"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTabType(value: unknown): value is TabType {
  return typeof value === "string" && TAB_TYPES.includes(value as TabType);
}

function isSplitDirection(value: unknown): value is SplitDirection {
  return typeof value === "string" && SPLIT_DIRECTIONS.includes(value as SplitDirection);
}

function isSafeSavedHostId(hostId: string): boolean {
  return hostId.length > 0 && !hostId.startsWith("quick-connect:");
}

function parsePersistedTab(value: unknown): PersistedSessionTab | null {
  if (!isRecord(value)) return null;
  const { id, type, hostId, hostLabel, hostAddress, panes, splitDirection, createdAt } = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    !isTabType(type) ||
    typeof hostId !== "string" ||
    !isSafeSavedHostId(hostId) ||
    typeof hostLabel !== "string" ||
    typeof hostAddress !== "string" ||
    !Array.isArray(panes) ||
    !isSplitDirection(splitDirection) ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  const seenPaneIds = new Set<string>();
  const safePanes = panes
    .filter(isRecord)
    .map((pane) => pane.id)
    .filter((paneId): paneId is string => {
      if (typeof paneId !== "string" || paneId.length === 0 || seenPaneIds.has(paneId)) {
        return false;
      }
      seenPaneIds.add(paneId);
      return true;
    })
    .map((paneId) => ({ id: paneId }));

  // SFTP/RDP/VNC não têm panes, enquanto um terminal precisa de ao menos um.
  if (type === "terminal" && safePanes.length === 0) return null;

  return {
    id,
    type,
    hostId,
    hostLabel,
    hostAddress,
    panes: type === "terminal" ? safePanes : [],
    splitDirection,
    createdAt,
  };
}

/**
 * Constrói o payload persistido removendo conexão e qualquer dado de autenticação.
 * Quick Connect nunca entra no payload, mesmo que uma chamada futura acrescente campos.
 */
export function serializeSessionState(tabs: SessionTab[], activeTabId: string | null): string {
  const persistedTabs: PersistedSessionTab[] = tabs
    .filter((tab) => isSafeSavedHostId(tab.hostId) && tab.connection?.source !== "quick-connect")
    .map(({ id, type, hostId, hostLabel, hostAddress, panes, splitDirection, createdAt }) => ({
      id,
      type,
      hostId,
      hostLabel,
      hostAddress,
      panes: panes.map(({ id: paneId }) => ({ id: paneId })),
      splitDirection,
      createdAt,
    }));

  const persistedIds = new Set(persistedTabs.map((tab) => tab.id));
  const payload: PersistedSessionState = {
    version: SESSION_PERSISTENCE_VERSION,
    tabs: persistedTabs,
    activeTabId: activeTabId && persistedIds.has(activeTabId) ? activeTabId : null,
  };
  return JSON.stringify(payload);
}

/** Lê apenas o formato conhecido; JSON inválido ou legado é tratado como armazenamento vazio. */
export function parseSessionState(raw: string | null): PersistedSessionState {
  if (!raw) return { version: SESSION_PERSISTENCE_VERSION, tabs: [], activeTabId: null };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== SESSION_PERSISTENCE_VERSION || !Array.isArray(parsed.tabs)) {
      return { version: SESSION_PERSISTENCE_VERSION, tabs: [], activeTabId: null };
    }

    const tabs = parsed.tabs.map(parsePersistedTab).filter((tab): tab is PersistedSessionTab => tab !== null);
    const ids = new Set(tabs.map((tab) => tab.id));
    const activeTabId = typeof parsed.activeTabId === "string" && ids.has(parsed.activeTabId)
      ? parsed.activeTabId
      : null;
    return { version: SESSION_PERSISTENCE_VERSION, tabs, activeTabId };
  } catch {
    return { version: SESSION_PERSISTENCE_VERSION, tabs: [], activeTabId: null };
  }
}

/** Converte metadados em abas inertes: sem connection e sempre desconectadas. */
export function restoreSessionTabs(
  persisted: PersistedSessionState,
  availableHostIds?: Iterable<string>,
): SessionTab[] {
  const allowedHostIds = availableHostIds ? new Set(availableHostIds) : undefined;
  const seenIds = new Set<string>();

  return persisted.tabs
    .filter((tab) => !allowedHostIds || allowedHostIds.has(tab.hostId))
    .filter((tab) => {
      if (seenIds.has(tab.id)) return false;
      seenIds.add(tab.id);
      return true;
    })
    .map((tab) => ({
      ...tab,
      panes: tab.panes.map(({ id }) => ({ id, status: "disconnected" as const })),
      status: "disconnected" as const,
      requiresExplicitReconnect: true,
    }));
}

export function readPersistedSessionTabs(
  raw: string | null,
  availableHostIds?: Iterable<string>,
): { tabs: SessionTab[]; activeTabId: string | null } {
  const persisted = parseSessionState(raw);
  const tabs = restoreSessionTabs(persisted, availableHostIds);
  const ids = new Set(tabs.map((tab) => tab.id));
  return {
    tabs,
    activeTabId: persisted.activeTabId && ids.has(persisted.activeTabId) ? persisted.activeTabId : tabs[0]?.id ?? null,
  };
}
