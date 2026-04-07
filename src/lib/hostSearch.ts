import { Credential, HostEntry } from "@/types";

export function getHostUsername(host: HostEntry, credential?: Credential): string {
  return credential?.username ?? host.username ?? "";
}

export function matchesHostSearch(
  host: HostEntry,
  search: string,
  credential?: Credential
): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  const username = getHostUsername(host, credential).toLowerCase();
  const haystack = [
    host.label,
    host.host,
    host.protocol,
    host.group,
    host.notes,
    username,
    ...(host.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

export function sortHosts(
  hosts: HostEntry[],
  getCredential: (credentialId: string) => Credential | undefined,
  mode: "recent" | "alphabetical"
): HostEntry[] {
  return [...hosts].sort((left, right) => {
    const leftUsername = getHostUsername(left, left.credentialId ? getCredential(left.credentialId) : undefined);
    const rightUsername = getHostUsername(right, right.credentialId ? getCredential(right.credentialId) : undefined);

    if (mode === "recent") {
      const leftLast = left.lastConnectedAt ? new Date(left.lastConnectedAt).getTime() : 0;
      const rightLast = right.lastConnectedAt ? new Date(right.lastConnectedAt).getTime() : 0;
      if (leftLast !== rightLast) return rightLast - leftLast;
    }

    return `${left.label}-${leftUsername}`.localeCompare(`${right.label}-${rightUsername}`);
  });
}

export function formatRelativeLastAccess(isoDate?: string, locale = "pt-BR"): string {
  if (!isoDate) return locale.startsWith("pt") ? "Nunca acessado" : "Never accessed";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return locale.startsWith("pt")
      ? `${diffMinutes} min atrás`
      : `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return locale.startsWith("pt")
      ? `${diffHours} h atrás`
      : `${diffHours} h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return locale.startsWith("pt")
    ? `${diffDays} d atrás`
    : `${diffDays} d ago`;
}
