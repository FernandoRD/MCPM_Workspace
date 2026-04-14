import { v4 as uuidv4 } from "uuid";
import { HostEntry, AuthMethod, ConnectionProtocol, SshCompatPreset } from "@/types";
import { sanitizeHostInput, sanitizeHosts } from "@/lib/inputSanitizers";

export const CSV_HOST_IMPORT_HEADERS = [
  "id",
  "label",
  "protocol",
  "host",
  "port",
  "username",
  "authMethod",
  "group",
  "tags",
  "notes",
  "color",
  "keepAliveInterval",
  "connectionTimeout",
  "sshCompatPreset",
] as const;

type CsvHostImportHeader = (typeof CSV_HOST_IMPORT_HEADERS)[number];

const REQUIRED_HEADERS: CsvHostImportHeader[] = ["label", "protocol", "host"];
const SUPPORTED_PROTOCOLS: ConnectionProtocol[] = ["ssh", "telnet", "rdp", "vnc"];
const SUPPORTED_AUTH_METHODS: AuthMethod[] = ["password", "privateKey", "agent"];
const SUPPORTED_SSH_COMPAT_PRESETS: SshCompatPreset[] = ["modern", "legacy", "very-legacy"];

export type CsvHostImportMode = "add" | "merge";

export interface CsvHostImportError {
  code:
    | "missingLabel"
    | "missingHost"
    | "invalidProtocol"
    | "invalidPort"
    | "invalidAuthMethod"
    | "invalidKeepAliveInterval"
    | "invalidConnectionTimeout"
    | "invalidSshCompatPreset"
    | "duplicateIdInFile"
    | "duplicateIdentityInFile";
  value?: string;
}

export interface CsvHostImportDraft {
  id?: string;
  label: string;
  protocol: ConnectionProtocol;
  host: string;
  port: number;
  username?: string;
  authMethod: AuthMethod;
  group?: string;
  tags: string[];
  notes?: string;
  color?: string;
  keepAliveInterval?: number;
  connectionTimeout?: number;
  sshCompat?: HostEntry["sshCompat"];
}

export interface CsvHostImportPreviewRow {
  lineNumber: number;
  raw: Record<string, string>;
  draft: CsvHostImportDraft | null;
  errors: CsvHostImportError[];
  existingHostId?: string;
  status: "new" | "matched" | "invalid";
}

export interface CsvHostImportPreview {
  headers: string[];
  rows: CsvHostImportPreviewRow[];
  counts: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    newRows: number;
    matchedRows: number;
  };
}

export interface CsvHostImportPlan {
  nextHosts: HostEntry[];
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  invalidCount: number;
}

export class CsvHostImportFatalError extends Error {
  constructor(
    public code: "missingHeaderRow" | "missingRequiredHeaders",
    public details: string[] = []
  ) {
    super(code);
  }
}

export function buildCsvHostTemplate(includeExample = false): string {
  const rows: string[][] = [Array.from(CSV_HOST_IMPORT_HEADERS)];

  if (includeExample) {
    rows.push([
      "",
      "Gateway Produção",
      "ssh",
      "10.10.10.15",
      "22",
      "ubuntu",
      "agent",
      "Produção",
      "linux;gateway;vpn",
      "Host de acesso ao ambiente principal",
      "#388bfd",
      "60",
      "10",
      "modern",
    ]);
    rows.push([
      "",
      "Servidor RDP Financeiro",
      "rdp",
      "192.168.20.40",
      "3389",
      "financeiro",
      "password",
      "Backoffice",
      "windows;financeiro",
      "Acesso ao sistema legado",
      "#d29922",
      "",
      "",
      "",
    ]);
    rows.push([
      "",
      "Console VNC Datacenter",
      "vnc",
      "192.168.30.15",
      "5900",
      "",
      "password",
      "Infra",
      "linux;console;datacenter",
      "Acesso VNC para manutenção visual",
      "#1f6feb",
      "",
      "",
      "",
    ]);
  }

  return stringifyCsv(rows);
}

export function parseCsvHostImport(raw: string, existingHosts: HostEntry[]): CsvHostImportPreview {
  const rows = parseCsvRows(raw);
  if (rows.length === 0) {
    throw new CsvHostImportFatalError("missingHeaderRow");
  }

  const headers = rows[0].map((value) => normalizeHeader(value));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new CsvHostImportFatalError("missingRequiredHeaders", missingHeaders);
  }

  const existingById = new Map(existingHosts.map((host) => [host.id, host]));
  const existingByIdentity = new Map(existingHosts.map((host) => [buildIdentityKey(host), host]));
  const seenIds = new Set<string>();
  const seenIdentities = new Set<string>();

  const previewRows: CsvHostImportPreviewRow[] = [];

  rows.slice(1).forEach((values, index) => {
    const lineNumber = index + 2;
    const rawRecord = buildRawRecord(headers, values);
    if (isBlankRecord(rawRecord)) return;

    const parsed = parsePreviewRow(rawRecord, lineNumber);
    if (parsed.draft?.id) {
      if (seenIds.has(parsed.draft.id)) {
        parsed.errors.push({ code: "duplicateIdInFile", value: parsed.draft.id });
      } else {
        seenIds.add(parsed.draft.id);
      }
    }

    if (parsed.draft) {
      const identityKey = buildIdentityKey(parsed.draft);
      if (seenIdentities.has(identityKey)) {
        parsed.errors.push({
          code: "duplicateIdentityInFile",
          value: `${parsed.draft.protocol}://${parsed.draft.host}:${parsed.draft.port}`,
        });
      } else {
        seenIdentities.add(identityKey);
      }
    }

    const existingHost =
      parsed.draft?.id && existingById.has(parsed.draft.id)
        ? existingById.get(parsed.draft.id)
        : parsed.draft
        ? existingByIdentity.get(buildIdentityKey(parsed.draft))
        : undefined;

    previewRows.push({
      ...parsed,
      existingHostId: existingHost?.id,
      status:
        parsed.errors.length > 0 || !parsed.draft
          ? "invalid"
          : existingHost
          ? "matched"
          : "new",
    });
  });

  const validRows = previewRows.filter((row) => row.status !== "invalid");
  const newRows = validRows.filter((row) => row.status === "new");
  const matchedRows = validRows.filter((row) => row.status === "matched");

  return {
    headers,
    rows: previewRows,
    counts: {
      totalRows: previewRows.length,
      validRows: validRows.length,
      invalidRows: previewRows.length - validRows.length,
      newRows: newRows.length,
      matchedRows: matchedRows.length,
    },
  };
}

export function buildCsvHostImportPlan(
  preview: CsvHostImportPreview,
  currentHosts: HostEntry[],
  mode: CsvHostImportMode
): CsvHostImportPlan {
  const nextHosts = sanitizeHosts([...currentHosts]);
  const nextHostIndexById = new Map(nextHosts.map((host, index) => [host.id, index]));
  const now = new Date().toISOString();

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const row of preview.rows) {
    if (row.status === "invalid" || !row.draft) continue;

    if (row.existingHostId) {
      if (mode === "add") {
        skippedCount += 1;
        continue;
      }

      const existingIndex = nextHostIndexById.get(row.existingHostId);
      if (existingIndex === undefined) {
        skippedCount += 1;
        continue;
      }

      const existing = nextHosts[existingIndex];
      const updated = sanitizeHostInput<HostEntry>({
        ...existing,
        label: row.draft.label,
        protocol: row.draft.protocol,
        host: row.draft.host,
        port: row.draft.port,
        username: row.draft.username,
        authMethod: row.draft.authMethod,
        group: row.draft.group,
        tags: row.draft.tags,
        notes: row.draft.notes,
        color: row.draft.color,
        keepAliveInterval: row.draft.keepAliveInterval,
        connectionTimeout: row.draft.connectionTimeout,
        sshCompat: row.draft.sshCompat,
        updatedAt: now,
      });

      nextHosts[existingIndex] = updated;
      updatedCount += 1;
      continue;
    }

    const created = sanitizeHostInput<HostEntry>({
      id: uuidv4(),
      label: row.draft.label,
      protocol: row.draft.protocol,
      host: row.draft.host,
      port: row.draft.port,
      username: row.draft.username,
      credentialId: undefined,
      authMethod: row.draft.authMethod,
      passwordRef: undefined,
      mfaEnabled: undefined,
      totpSecret: undefined,
      totpAlgorithm: undefined,
      group: row.draft.group,
      tags: row.draft.tags,
      notes: row.draft.notes,
      jumpHostId: undefined,
      lastConnectedAt: undefined,
      createdAt: now,
      updatedAt: now,
      color: row.draft.color,
      sshCompat: row.draft.sshCompat,
      keepAliveInterval: row.draft.keepAliveInterval,
      connectionTimeout: row.draft.connectionTimeout,
    });

    nextHosts.push(created);
    nextHostIndexById.set(created.id, nextHosts.length - 1);
    createdCount += 1;
  }

  return {
    nextHosts,
    createdCount,
    updatedCount,
    skippedCount,
    invalidCount: preview.counts.invalidRows,
  };
}

function parsePreviewRow(
  rawRecord: Record<string, string>,
  lineNumber: number
): Omit<CsvHostImportPreviewRow, "existingHostId" | "status"> {
  const label = rawRecord["label"]?.trim() ?? "";
  const host = rawRecord["host"]?.trim() ?? "";
  const protocolInput = (rawRecord["protocol"] ?? "").trim().toLowerCase();
  const protocol = parseProtocol(protocolInput);
  const portValue = (rawRecord["port"] ?? "").trim();
  const authMethodValue = (rawRecord["authMethod"] ?? "").trim();
  const tags = parseTags(rawRecord["tags"] ?? "");
  const username = normalizeOptionalString(rawRecord["username"]);
  const group = normalizeOptionalString(rawRecord["group"]);
  const notes = normalizeOptionalString(rawRecord["notes"]);
  const color = normalizeOptionalString(rawRecord["color"]);
  const keepAliveInterval = parseOptionalInteger(rawRecord["keepAliveInterval"]);
  const connectionTimeout = parseOptionalInteger(rawRecord["connectionTimeout"]);
  const sshCompatPreset = normalizeOptionalString(rawRecord["sshCompatPreset"]);
  const errors: CsvHostImportError[] = [];

  if (!label) errors.push({ code: "missingLabel" });
  if (!host) errors.push({ code: "missingHost" });
  if (!protocol) {
    errors.push({ code: "invalidProtocol", value: protocolInput });
  }

  let port = protocol ? defaultPortForProtocol(protocol) : 22;
  if (portValue) {
    const parsedPort = Number(portValue);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      errors.push({ code: "invalidPort", value: portValue });
    } else {
      port = parsedPort;
    }
  }

  let authMethod: AuthMethod = protocol === "ssh" ? "agent" : "password";
  if (authMethodValue) {
    if (SUPPORTED_AUTH_METHODS.includes(authMethodValue as AuthMethod)) {
      authMethod = authMethodValue as AuthMethod;
    } else {
      errors.push({ code: "invalidAuthMethod", value: authMethodValue });
    }
  }

  if (keepAliveInterval === "invalid") {
    errors.push({ code: "invalidKeepAliveInterval", value: rawRecord["keepAliveInterval"] });
  }
  if (connectionTimeout === "invalid") {
    errors.push({ code: "invalidConnectionTimeout", value: rawRecord["connectionTimeout"] });
  }

  let sshCompat: HostEntry["sshCompat"];
  if (sshCompatPreset) {
    if (SUPPORTED_SSH_COMPAT_PRESETS.includes(sshCompatPreset as SshCompatPreset)) {
      sshCompat = { preset: sshCompatPreset as SshCompatPreset };
    } else {
      errors.push({ code: "invalidSshCompatPreset", value: sshCompatPreset });
    }
  }

  if (protocol && protocol !== "ssh") {
    sshCompat = undefined;
  }

  return {
    lineNumber,
    raw: rawRecord,
    draft:
      errors.length > 0 || !protocol
        ? null
        : {
            id: normalizeOptionalString(rawRecord["id"]),
            label,
            protocol,
            host,
            port,
            username,
            authMethod,
            group,
            tags,
            notes,
            color,
            keepAliveInterval:
              keepAliveInterval === "invalid" ? undefined : keepAliveInterval,
            connectionTimeout:
              connectionTimeout === "invalid" ? undefined : connectionTimeout,
            sshCompat,
          },
    errors,
  };
}

function parseProtocol(value: string): ConnectionProtocol | null {
  if (SUPPORTED_PROTOCOLS.includes(value as ConnectionProtocol)) {
    return value as ConnectionProtocol;
  }

  return null;
}

function defaultPortForProtocol(protocol: ConnectionProtocol): number {
  if (protocol === "telnet") return 23;
  if (protocol === "rdp") return 3389;
  if (protocol === "vnc") return 5900;
  return 22;
}

function parseOptionalInteger(value: string | undefined): number | "invalid" | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) return "invalid";
  return parsed;
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[;,]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim();
}

function buildRawRecord(headers: string[], values: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index] ?? "";
  });
  return record;
}

function isBlankRecord(record: Record<string, string>): boolean {
  return Object.values(record).every((value) => value.trim() === "");
}

function buildIdentityKey(host: Pick<HostEntry, "protocol" | "host" | "port" | "username">): string {
  return [
    host.protocol,
    host.host.trim().toLowerCase(),
    String(host.port),
    (host.username ?? "").trim().toLowerCase(),
  ].join("|");
}

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function stringifyCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const normalized = value ?? "";
          if (/[",\n\r]/.test(normalized)) {
            return `"${normalized.replace(/"/g, "\"\"")}"`;
          }
          return normalized;
        })
        .join(",")
    )
    .join("\n");
}
