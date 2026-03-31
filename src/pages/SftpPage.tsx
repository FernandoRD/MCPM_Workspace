import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Folder,
  File,
  FolderPlus,
  FileUp,
  FileDown,
  Pencil,
  Trash2,
  RefreshCw,
  ChevronRight,
  WifiOff,
  RotateCcw,
  Home,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useSessionsStore } from "@/store/sessions";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { Button } from "@/components/ui/Button";

interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number;
}

type Status = "connecting" | "connected" | "disconnected" | "error";

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export function SftpPage() {
  const { t } = useTranslation();
  const { tabId } = useParams<{ tabId: string }>();
  const navigate = useNavigate();

  const tabs = useSessionsStore((s) => s.tabs);
  const updatePaneStatus = useSessionsStore((s) => s.updatePaneStatus);
  const getHost = useHostsStore((s) => s.getHost);
  const setLastConnected = useHostsStore((s) => s.setLastConnected);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const getSshKey = useSshKeysStore((s) => s.getSshKey);

  const tab = tabs.find((t) => t.id === tabId);
  const host = tab ? getHost(tab.hostId) : undefined;

  const [status, setStatus] = useState<Status>("connecting");
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // New folder state
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm state
  const [deletingEntry, setDeletingEntry] = useState<SftpEntry | null>(null);

  const sessionId = tabId!;

  const connect = useCallback(async () => {
    if (!host) return;
    setStatus("connecting");
    setError(null);

    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const authMethod = credential?.authMethod ?? host.authMethod ?? "password";
    const username = credential?.username ?? host.username ?? "";
    const password = credential?.password ?? host.passwordRef ?? null;
    const sshKey = credential?.keyId ? getSshKey(credential.keyId) : undefined;
    const privateKeyContent = sshKey?.privateKeyContent ?? null;
    const privateKeyPassphrase = sshKey?.passphrase ?? null;

    try {
      await invoke("sftp_connect", {
        sessionId,
        host: host.host,
        port: host.port,
        username,
        authMethod,
        password,
        privateKeyContent,
        privateKeyPassphrase,
      });
      setStatus("connected");
      setLastConnected(host.id);
      updatePaneStatus(sessionId, "connected");
      await loadDir("/");
    } catch (err) {
      setStatus("error");
      setError(String(err));
      updatePaneStatus(sessionId, "error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, host]);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SftpEntry[]>("sftp_read_dir", { sessionId, path });
      setEntries(result);
      setCurrentPath(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    connect();
    return () => {
      invoke("sftp_disconnect", { sessionId }).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingPath && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingPath]);

  // Focus new-folder input when it appears
  useEffect(() => {
    if (creatingFolder && newFolderInputRef.current) newFolderInputRef.current.focus();
  }, [creatingFolder]);

  const handleEntryClick = (entry: SftpEntry) => {
    if (entry.is_dir) loadDir(entry.path);
  };

  const handleDownload = async (entry: SftpEntry) => {
    const savePath = await save({ defaultPath: entry.name });
    if (!savePath) return;
    try {
      await invoke("sftp_download", { sessionId, remotePath: entry.path, localPath: savePath });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleUpload = async () => {
    const filePath = await open({ multiple: false, directory: false });
    if (!filePath) return;
    const fileName = (filePath as string).split("/").pop() ?? "upload";
    const remotePath = currentPath.endsWith("/")
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;
    try {
      await invoke("sftp_upload", { sessionId, localPath: filePath, remotePath });
      await loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleMkdir = async () => {
    if (!newFolderName.trim()) { setCreatingFolder(false); return; }
    const path = currentPath.endsWith("/")
      ? `${currentPath}${newFolderName.trim()}`
      : `${currentPath}/${newFolderName.trim()}`;
    try {
      await invoke("sftp_mkdir", { sessionId, path });
      setCreatingFolder(false);
      setNewFolderName("");
      await loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (entry: SftpEntry) => {
    try {
      await invoke("sftp_delete", { sessionId, path: entry.path, isDir: entry.is_dir });
      setDeletingEntry(null);
      await loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRename = async (entry: SftpEntry) => {
    if (!renameValue.trim() || renameValue === entry.name) {
      setRenamingPath(null);
      return;
    }
    const parent = entry.path.split("/").slice(0, -1).join("/") || "/";
    const newPath = `${parent}/${renameValue.trim()}`;
    try {
      await invoke("sftp_rename", { sessionId, oldPath: entry.path, newPath });
      setRenamingPath(null);
      setRenameValue("");
      await loadDir(currentPath);
    } catch (err) {
      setError(String(err));
    }
  };

  // Breadcrumb segments
  const breadcrumbs = currentPath === "/"
    ? [{ label: "/", path: "/" }]
    : currentPath.split("/").filter(Boolean).reduce<{ label: string; path: string }[]>(
        (acc, segment) => {
          const prev = acc[acc.length - 1]?.path ?? "";
          return [...acc, { label: segment, path: `${prev}/${segment}` }];
        },
        [{ label: "/", path: "/" }]
      );

  if (!tab || !host) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">Sessão não encontrada</p>
        <Button onClick={() => navigate("/")}>Voltar</Button>
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
        <RefreshCw size={24} className="animate-spin" />
        <p className="text-sm">{t("sftp.connecting")}</p>
      </div>
    );
  }

  if (status === "disconnected" || status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--danger)]" />
        <p className="text-sm text-[var(--text-primary)]">{t("sftp.disconnected")}</p>
        {error && <p className="text-xs text-[var(--danger)] max-w-xs text-center">{error}</p>}
        <Button size="sm" onClick={connect}>
          <RotateCcw size={13} />
          {t("sftp.reconnect")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)] shrink-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm overflow-x-auto scrollbar-hide">
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.path} className="flex items-center gap-1 shrink-0">
              {idx > 0 && <ChevronRight size={12} className="text-[var(--text-muted)]" />}
              <button
                className={`hover:text-[var(--accent)] transition-colors ${
                  idx === breadcrumbs.length - 1
                    ? "text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-muted)]"
                }`}
                onClick={() => loadDir(crumb.path)}
              >
                {idx === 0 ? <Home size={13} /> : crumb.label}
              </button>
            </span>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={handleUpload} title={t("sftp.upload")}>
            <FileUp size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setCreatingFolder(true); setNewFolderName(""); }}
            title={t("sftp.newFolder")}
          >
            <FolderPlus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadDir(currentPath)}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--danger)]/10 border-b border-[var(--danger)]/20 text-[var(--danger)] text-xs shrink-0">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-[var(--text-muted)]">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">{t("sftp.loading")}</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
            {t("sftp.emptyFolder")}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-[var(--text-muted)] w-full">
                  {t("sftp.columns.name")}
                </th>
                <th className="text-right px-3 py-2 font-medium text-[var(--text-muted)] whitespace-nowrap">
                  {t("sftp.columns.size")}
                </th>
                <th className="text-right px-3 py-2 font-medium text-[var(--text-muted)] whitespace-nowrap hidden md:table-cell">
                  {t("sftp.columns.modified")}
                </th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {/* New folder row */}
              {creatingFolder && (
                <tr className="border-b border-[var(--border)] bg-[var(--accent)]/5">
                  <td className="px-3 py-1.5" colSpan={4}>
                    <div className="flex items-center gap-2">
                      <Folder size={15} className="text-[var(--accent)] shrink-0" />
                      <input
                        ref={newFolderInputRef}
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleMkdir();
                          if (e.key === "Escape") setCreatingFolder(false);
                        }}
                        placeholder={t("sftp.newFolderPlaceholder")}
                        className="flex-1 bg-transparent border-b border-[var(--accent)] outline-none text-sm py-0.5"
                      />
                      <button
                        className="text-xs text-[var(--accent)] hover:underline"
                        onClick={handleMkdir}
                      >
                        OK
                      </button>
                      <button
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        onClick={() => setCreatingFolder(false)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {entries.map((entry) => (
                <tr
                  key={entry.path}
                  className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)] group transition-colors"
                >
                  {/* Name cell */}
                  <td className="px-3 py-1.5">
                    {renamingPath === entry.path ? (
                      <div className="flex items-center gap-2">
                        {entry.is_dir
                          ? <Folder size={15} className="text-[var(--accent)] shrink-0" />
                          : <File size={15} className="text-[var(--text-muted)] shrink-0" />
                        }
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(entry);
                            if (e.key === "Escape") setRenamingPath(null);
                          }}
                          className="flex-1 bg-transparent border-b border-[var(--accent)] outline-none text-sm py-0.5"
                        />
                        <button
                          className="text-xs text-[var(--accent)] hover:underline"
                          onClick={() => handleRename(entry)}
                        >
                          OK
                        </button>
                        <button
                          className="text-xs text-[var(--text-muted)]"
                          onClick={() => setRenamingPath(null)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="flex items-center gap-2 w-full text-left"
                        onClick={() => handleEntryClick(entry)}
                      >
                        {entry.is_dir
                          ? <Folder size={15} className="text-[var(--accent)] shrink-0" />
                          : <File size={15} className="text-[var(--text-muted)] shrink-0" />
                        }
                        <span className={`truncate ${entry.is_dir ? "font-medium" : ""}`}>
                          {entry.name}
                        </span>
                      </button>
                    )}
                  </td>

                  {/* Size */}
                  <td className="px-3 py-1.5 text-right text-[var(--text-muted)] whitespace-nowrap tabular-nums">
                    {entry.is_dir ? "—" : formatSize(entry.size)}
                  </td>

                  {/* Modified */}
                  <td className="px-3 py-1.5 text-right text-[var(--text-muted)] whitespace-nowrap hidden md:table-cell">
                    {formatDate(entry.modified)}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!entry.is_dir && (
                        <button
                          className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          title={t("sftp.download")}
                          onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                        >
                          <FileDown size={13} />
                        </button>
                      )}
                      <button
                        className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        title={t("sftp.rename")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingPath(entry.path);
                          setRenameValue(entry.name);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--danger)] transition-colors"
                        title={t("sftp.delete")}
                        onClick={(e) => { e.stopPropagation(); setDeletingEntry(entry); }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirm modal */}
      {deletingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg p-5 w-80 shadow-xl">
            <h3 className="font-semibold text-[var(--text-primary)] mb-1">
              {t("sftp.confirmDelete", { name: deletingEntry.name })}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">{t("sftp.confirmDeleteDesc")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeletingEntry(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                className="bg-[var(--danger)] hover:bg-[var(--danger)]/90 text-white"
                onClick={() => handleDelete(deletingEntry)}
              >
                {t("sftp.delete")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
