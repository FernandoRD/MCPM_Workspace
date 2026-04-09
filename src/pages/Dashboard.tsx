import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search,
  Server,
  Edit2,
  Trash2,
  Copy,
  Terminal,
  Monitor,
  MoreVertical,
  ShieldCheck,
  Layers,
  FolderOpen,
  ArrowUpAZ,
  ArrowDownAZ,
  Clock,
  ClockArrowUp,
  Tag,
  X,
  CheckSquare,
  Square,
  PencilLine,
  UserRound,
} from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { useUIStore, DashboardSortBy } from "@/store/uiStore";
import { useSessionsStore } from "@/store/sessions";
import { useCredentialsStore } from "@/store/credentials";
import { useSettingsStore } from "@/store/settings";
import { Credential, HostEntry } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { TagBadge } from "@/components/ui/TagBadge";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { SshConfigImportModal } from "@/components/SshConfigImportModal";
import { NewConnectionSplitButton } from "@/components/NewConnectionSplitButton";
import { launchRdpSession, launchTerminalSession } from "@/lib/sessionLauncher";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { buildSessionRoute, isStandaloneWindow } from "@/lib/windowMode";

type BulkEditCredentialMode = "keep" | "set" | "clear";
type BulkEditGroupMode = "keep" | "set" | "clear";
type BulkEditTagsMode = "keep" | "replace" | "add" | "remove" | "clear";

interface BulkEditChanges {
  credentialMode: BulkEditCredentialMode;
  credentialId?: string;
  groupMode: BulkEditGroupMode;
  groupName?: string;
  tagsMode: BulkEditTagsMode;
  tags: string[];
}

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const hosts = useHostsStore((s) => s.hosts);
  const { deleteHost, duplicateHost, updateHost } = useHostsStore();
  const openSession = useSessionsStore((s) => s.openSession);
  const openSftpTab = useSessionsStore((s) => s.openSftpTab);
  const openRdpTab = useSessionsStore((s) => s.openRdpTab);
  const credentials = useCredentialsStore((s) => s.credentials);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const locale = useSettingsStore((s) => s.settings.locale);
  const sessionOpenMode = useSettingsStore((s) => s.settings.terminal.sessionOpenMode);
  const savedGroups = useSettingsStore((s) => s.settings.groups);
  const updateGroups = useSettingsStore((s) => s.updateGroups);
  const standaloneWindow = isStandaloneWindow(location.search);

  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [showSshConfigImport, setShowSshConfigImport] = useState(false);
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);

  const search = useUIStore((s) => s.dashboardSearch);
  const setSearch = useUIStore((s) => s.setDashboardSearch);
  const selectedGroup = useUIStore((s) => s.dashboardSelectedGroup);
  const setSelectedGroup = useUIStore((s) => s.setDashboardSelectedGroup);
  const sortBy = useUIStore((s) => s.dashboardSortBy);
  const setSortBy = useUIStore((s) => s.setDashboardSortBy);
  const selectedTags = useUIStore((s) => s.dashboardSelectedTags);
  const toggleTag = useUIStore((s) => s.toggleDashboardTag);
  const clearTags = useUIStore((s) => s.clearDashboardTags);
  const [menuHostId, setMenuHostId] = useState<string | null>(null);

  const allTags = [...new Set(hosts.flatMap((host) => host.tags))].sort((left, right) =>
    left.localeCompare(right)
  );

  const allGroups = [
    ...new Set([
      ...hosts.map((host) => host.group).filter((group): group is string => !!group),
      ...savedGroups,
    ]),
  ].sort((left, right) => left.localeCompare(right));

  const groupCount = hosts.reduce<Record<string, number>>((acc, host) => {
    if (host.group) acc[host.group] = (acc[host.group] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = hosts
    .filter((host) => {
      const matchSearch =
        host.label.toLowerCase().includes(search.toLowerCase()) ||
        host.host.toLowerCase().includes(search.toLowerCase()) ||
        host.protocol.toLowerCase().includes(search.toLowerCase()) ||
        host.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      const matchGroup = selectedGroup === null || host.group === selectedGroup;
      const matchTag = selectedTags.length === 0 || selectedTags.some((tag) => host.tags.includes(tag));
      return matchSearch && matchGroup && matchTag;
    })
    .sort((left, right) => {
      if (sortBy === "label-asc") return left.label.localeCompare(right.label);
      if (sortBy === "label-desc") return right.label.localeCompare(left.label);

      const leftDate = left.lastConnectedAt ? new Date(left.lastConnectedAt).getTime() : 0;
      const rightDate = right.lastConnectedAt ? new Date(right.lastConnectedAt).getTime() : 0;

      if (sortBy === "recent") return rightDate - leftDate;
      if (sortBy === "oldest") {
        if (!left.lastConnectedAt && !right.lastConnectedAt) return 0;
        if (!left.lastConnectedAt) return 1;
        if (!right.lastConnectedAt) return -1;
        return leftDate - rightDate;
      }
      return 0;
    });

  useEffect(() => {
    const hostIds = new Set(hosts.map((host) => host.id));
    setSelectedHostIds((current) => current.filter((id) => hostIds.has(id)));
  }, [hosts]);

  const selectedVisibleIds = useMemo(
    () => filtered.map((host) => host.id).filter((id) => selectedHostIds.includes(id)),
    [filtered, selectedHostIds]
  );

  const allVisibleSelected = filtered.length > 0 && selectedVisibleIds.length === filtered.length;
  const selectedHosts = useMemo(
    () => hosts.filter((host) => selectedHostIds.includes(host.id)),
    [hosts, selectedHostIds]
  );

  const handleConnect = async (host: HostEntry) => {
    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = credential?.username ?? host.username ?? "";
    const hostAddress = username ? `${username}@${host.host}` : host.host;
    if (host.protocol === "rdp") {
      const route = await launchRdpSession({
        hostId: host.id,
        hostLabel: host.label,
        hostAddress,
        openMode: sessionOpenMode,
        openRdpTab,
        standaloneWindow,
      });
      if (route) navigate(route);
      return;
    }
    const route = await launchTerminalSession({
      hostId: host.id,
      hostLabel: host.label,
      hostAddress,
      openMode: sessionOpenMode,
      openSession,
      standaloneWindow,
    });
    if (route) navigate(route);
  };

  const handleOpenSftp = (host: HostEntry) => {
    if (host.protocol !== "ssh") return;
    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = credential?.username ?? host.username ?? "";
    const hostAddress = username ? `${username}@${host.host}` : host.host;
    const tabId = openSftpTab(host.id, host.label, hostAddress);
    navigate(
      buildSessionRoute("sftp", tabId, {
        standalone: standaloneWindow,
        hostId: standaloneWindow ? host.id : undefined,
        hostLabel: standaloneWindow ? host.label : undefined,
        hostAddress: standaloneWindow ? hostAddress : undefined,
      })
    );
  };

  const toggleHostSelection = (hostId: string) => {
    setSelectedHostIds((current) =>
      current.includes(hostId) ? current.filter((id) => id !== hostId) : [...current, hostId]
    );
  };

  const toggleVisibleSelection = () => {
    if (allVisibleSelected) {
      setSelectedHostIds((current) => current.filter((id) => !selectedVisibleIds.includes(id)));
      return;
    }

    const next = new Set(selectedHostIds);
    filtered.forEach((host) => next.add(host.id));
    setSelectedHostIds(Array.from(next));
  };

  const clearSelection = () => setSelectedHostIds([]);

  const handleBulkApply = (changes: BulkEditChanges) => {
    let nextGroups = savedGroups;

    selectedHosts.forEach((host) => {
      const selectedCredential = changes.credentialId
        ? credentials.find((credential) => credential.id === changes.credentialId)
        : undefined;

      const payload: Partial<HostEntry> = {
        tags: applyTagMode(host.tags, changes.tagsMode, changes.tags),
      };

      if (changes.credentialMode === "set") {
        payload.credentialId = changes.credentialId;
        if (selectedCredential) {
          payload.authMethod = selectedCredential.authMethod;
        }
      } else if (changes.credentialMode === "clear") {
        payload.credentialId = undefined;
      }

      if (changes.groupMode === "set") {
        payload.group = changes.groupName;
        if (changes.groupName && !nextGroups.includes(changes.groupName)) {
          nextGroups = [...nextGroups, changes.groupName].sort((left, right) => left.localeCompare(right));
        }
      } else if (changes.groupMode === "clear") {
        payload.group = undefined;
      }

      updateHost(host.id, payload);
    });

    if (nextGroups !== savedGroups) {
      updateGroups(nextGroups);
    }

    clearSelection();
    setShowBulkEditModal(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t("dashboard.title")}</h1>
        <div className="flex items-center gap-2">
          <NewConnectionSplitButton
            size="sm"
            standaloneWindow={standaloneWindow}
            onImportSshConfig={() => setShowSshConfigImport(true)}
          />
        </div>
      </div>

      <BulkEditHostsModal
        open={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        selectedCount={selectedHostIds.length}
        credentials={credentials}
        groups={allGroups}
        onApply={handleBulkApply}
      />
      <SshConfigImportModal
        open={showSshConfigImport}
        onClose={() => setShowSshConfigImport(false)}
      />

      <div className="px-6 py-3 border-b border-[var(--border)] flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("dashboard.searchPlaceholder")}
            className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] pl-9 pr-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
          />
          {search.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={t("dashboard.clearSearch")}
              title={t("dashboard.clearSearch")}
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <SortSelector value={sortBy} onChange={setSortBy} />
      </div>

      {selectedHostIds.length > 0 && (
        <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--accent-subtle)]/70">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <CheckSquare size={15} className="text-[var(--accent)]" />
              {t("dashboard.bulk.selected", { count: selectedHostIds.length })}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={toggleVisibleSelection}>
                {allVisibleSelected ? <Square size={14} /> : <CheckSquare size={14} />}
                {allVisibleSelected
                  ? t("dashboard.bulk.unselectVisible")
                  : t("dashboard.bulk.selectVisible")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowBulkEditModal(true)}>
                <PencilLine size={14} />
                {t("dashboard.bulk.editSelected")}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                {t("dashboard.bulk.clearSelection")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-4 flex flex-col gap-4">
        {hosts.length === 0 ? (
          <EmptyState
            standaloneWindow={standaloneWindow}
            onImportSshConfig={() => setShowSshConfigImport(true)}
          />
        ) : (
          <>
            {allGroups.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedGroup(null)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selectedGroup === null
                      ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                      : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                  )}
                >
                  <Server size={13} />
                  {t("dashboard.allHosts")}
                  <span className="text-xs opacity-70">({hosts.length})</span>
                </button>

                {allGroups.map((group) => (
                  <button
                    key={group}
                    onClick={() => setSelectedGroup(selectedGroup === group ? null : group)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      selectedGroup === group
                        ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                        : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                    )}
                  >
                    <Layers size={13} />
                    {group}
                    <span className="text-xs opacity-70">({groupCount[group] ?? 0})</span>
                  </button>
                ))}
              </div>
            )}

            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] shrink-0">
                  <Tag size={11} />
                  {t("dashboard.tags.label")}:
                </span>
                {allTags.map((tag) => (
                  <TagBadge
                    key={tag}
                    tag={tag}
                    onClick={() => toggleTag(tag)}
                    selected={selectedTags.includes(tag)}
                    className="hover:brightness-95"
                  >
                    {tag}
                  </TagBadge>
                ))}
                {selectedTags.length > 0 && (
                  <button
                    onClick={clearTags}
                    className="flex items-center gap-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-1"
                  >
                    <X size={11} />
                    {t("dashboard.tags.clear")}
                  </button>
                )}
              </div>
            )}

            {filtered.length === 0 ? (
              <p className="text-center py-12 text-[var(--text-muted)]">{t("common.noResults")}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filtered.map((host) => (
                  <HostCard
                    key={host.id}
                    host={host}
                    locale={locale}
                    menuOpen={menuHostId === host.id}
                    selected={selectedHostIds.includes(host.id)}
                    onMenuToggle={(id) => setMenuHostId((current) => (current === id ? null : id))}
                    onToggleSelected={toggleHostSelection}
                    onConnect={handleConnect}
                    onOpenSftp={handleOpenSftp}
                    onEdit={(item) => navigate(`/hosts/${item.id}`)}
                    onDelete={(id) => deleteHost(id)}
                    onDuplicate={(id) => duplicateHost(id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SORT_OPTIONS: { value: DashboardSortBy; icon: React.ElementType; labelKey: string }[] = [
  { value: "label-asc", icon: ArrowUpAZ, labelKey: "dashboard.sort.labelAsc" },
  { value: "label-desc", icon: ArrowDownAZ, labelKey: "dashboard.sort.labelDesc" },
  { value: "recent", icon: Clock, labelKey: "dashboard.sort.recent" },
  { value: "oldest", icon: ClockArrowUp, labelKey: "dashboard.sort.oldest" },
];

function SortSelector({
  value,
  onChange,
}: {
  value: DashboardSortBy;
  onChange: (value: DashboardSortBy) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="relative flex items-center">
      <div className="flex items-center gap-1 h-9 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
        {SORT_OPTIONS.map(({ value: optionValue, icon: Icon, labelKey }) => (
          <button
            key={optionValue}
            title={t(labelKey)}
            onClick={() => onChange(optionValue)}
            className={cn(
              "h-full px-2.5 flex items-center justify-center transition-colors",
              value === optionValue
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            )}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

function HostCard({
  host,
  locale,
  menuOpen,
  selected,
  onMenuToggle,
  onToggleSelected,
  onConnect,
  onOpenSftp,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  host: HostEntry;
  locale: string;
  menuOpen: boolean;
  selected: boolean;
  onMenuToggle: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onConnect: (host: HostEntry) => void;
  onOpenSftp: (host: HostEntry) => void;
  onEdit: (host: HostEntry) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "relative group flex flex-col gap-3 rounded-xl border bg-[var(--bg-secondary)] p-4 transition-colors",
        selected
          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/20"
          : "border-[var(--border)] hover:border-[var(--border-focus)]"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => onToggleSelected(host.id)}
            className={cn(
              "mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
              selected
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]"
            )}
            title={selected ? t("dashboard.bulk.unselectHost") : t("dashboard.bulk.selectHost")}
          >
            {selected ? <CheckSquare size={12} /> : <Square size={12} />}
          </button>
          <div
            className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: host.color ?? "var(--accent)" }}
          >
            {host.label.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-[var(--text-primary)] leading-tight truncate max-w-[130px]">
              {host.label}
            </p>
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-xs text-[var(--text-muted)] truncate max-w-[130px]">
                {host.host}:{host.port}
              </p>
              <Badge variant={host.protocol === "telnet" ? "warning" : "accent"}>
                {t(`protocols.${host.protocol}`)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => onMenuToggle(host.id)}
            className={cn(
              "h-7 w-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl py-1">
              <ContextItem
                icon={host.protocol === "rdp" ? Monitor : Terminal}
                label={t(host.protocol === "rdp" ? "dashboard.host.openDesktop" : "dashboard.host.connect")}
                onClick={() => onConnect(host)}
              />
              {host.protocol === "ssh" && (
                <ContextItem icon={FolderOpen} label={t("dashboard.host.openSftp")} onClick={() => onOpenSftp(host)} />
              )}
              <ContextItem icon={Edit2} label={t("dashboard.host.edit")} onClick={() => onEdit(host)} />
              <ContextItem icon={Copy} label={t("dashboard.host.duplicate")} onClick={() => onDuplicate(host.id)} />
              <div className="my-1 border-t border-[var(--border)]" />
              <ContextItem icon={Trash2} label={t("dashboard.host.delete")} onClick={() => onDelete(host.id)} danger />
            </div>
          )}
        </div>
      </div>

      {(host.tags.length > 0 || host.mfaEnabled) && (
        <div className="flex flex-wrap gap-1">
          {host.mfaEnabled && (
            <Badge variant="accent" className="flex items-center gap-1">
              <ShieldCheck size={10} />
              {t("dashboard.host.mfaBadge")}
            </Badge>
          )}
          {host.tags.slice(0, 3).map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
          {host.tags.length > 3 && <Badge>+{host.tags.length - 3}</Badge>}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--border)]">
        <p className="text-xs text-[var(--text-muted)]">
          {host.lastConnectedAt ? formatDate(host.lastConnectedAt, locale) : t("dashboard.host.neverConnected")}
        </p>
        <Button size="sm" onClick={() => onConnect(host)}>
          {host.protocol === "rdp" ? <Monitor size={12} /> : <Terminal size={12} />}
          {t(host.protocol === "rdp" ? "dashboard.host.openDesktop" : "dashboard.host.connect")}
        </Button>
      </div>
    </div>
  );
}

function BulkEditHostsModal({
  open,
  onClose,
  selectedCount,
  credentials,
  groups,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  credentials: Credential[];
  groups: string[];
  onApply: (changes: BulkEditChanges) => void;
}) {
  const { t } = useTranslation();
  const [credentialMode, setCredentialMode] = useState<BulkEditCredentialMode>("keep");
  const [credentialId, setCredentialId] = useState("");
  const [groupMode, setGroupMode] = useState<BulkEditGroupMode>("keep");
  const [groupName, setGroupName] = useState("");
  const [tagsMode, setTagsMode] = useState<BulkEditTagsMode>("keep");
  const [tagsInput, setTagsInput] = useState("");

  useEffect(() => {
    if (!open) {
      setCredentialMode("keep");
      setCredentialId("");
      setGroupMode("keep");
      setGroupName("");
      setTagsMode("keep");
      setTagsInput("");
    }
  }, [open]);

  const parsedTags = parseTagList(tagsInput);
  const applyDisabled =
    selectedCount === 0 ||
    (credentialMode === "set" && !credentialId) ||
    (groupMode === "set" && !groupName.trim()) ||
    (tagsMode !== "keep" && tagsMode !== "clear" && parsedTags.length === 0);

  return (
    <Modal open={open} onClose={onClose} title={t("dashboard.bulk.modalTitle")} size="lg">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-[var(--text-muted)]">
          {t("dashboard.bulk.modalDescription", { count: selectedCount })}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <UserRound size={14} className="text-[var(--accent)]" />
              {t("dashboard.bulk.fields.credential")}
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <Select
                value={credentialMode}
                onChange={(event) => setCredentialMode(event.target.value as BulkEditCredentialMode)}
              >
                <option value="keep">{t("dashboard.bulk.modes.keep")}</option>
                <option value="set">{t("dashboard.bulk.modes.set")}</option>
                <option value="clear">{t("dashboard.bulk.modes.clear")}</option>
              </Select>

              {credentialMode === "set" && (
                <Select
                  value={credentialId}
                  onChange={(event) => setCredentialId(event.target.value)}
                >
                  <option value="">{t("dashboard.bulk.placeholders.selectCredential")}</option>
                  {credentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.label} {credential.username ? `· ${credential.username}` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <Layers size={14} className="text-[var(--accent)]" />
              {t("dashboard.bulk.fields.group")}
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <Select
                value={groupMode}
                onChange={(event) => setGroupMode(event.target.value as BulkEditGroupMode)}
              >
                <option value="keep">{t("dashboard.bulk.modes.keep")}</option>
                <option value="set">{t("dashboard.bulk.modes.set")}</option>
                <option value="clear">{t("dashboard.bulk.modes.clear")}</option>
              </Select>

              {groupMode === "set" && (
                <>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder={t("dashboard.bulk.placeholders.group")}
                    list="dashboard-bulk-groups"
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
                  />
                  <datalist id="dashboard-bulk-groups">
                    {groups.map((group) => (
                      <option key={group} value={group} />
                    ))}
                  </datalist>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Tag size={14} className="text-[var(--accent)]" />
            {t("dashboard.bulk.fields.tags")}
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-3">
            <Select
              value={tagsMode}
              onChange={(event) => setTagsMode(event.target.value as BulkEditTagsMode)}
            >
              <option value="keep">{t("dashboard.bulk.modes.keep")}</option>
              <option value="replace">{t("dashboard.bulk.tagsModes.replace")}</option>
              <option value="add">{t("dashboard.bulk.tagsModes.add")}</option>
              <option value="remove">{t("dashboard.bulk.tagsModes.remove")}</option>
              <option value="clear">{t("dashboard.bulk.modes.clear")}</option>
            </Select>

            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder={t("dashboard.bulk.placeholders.tags")}
                disabled={tagsMode === "keep" || tagsMode === "clear"}
                className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] disabled:opacity-50"
              />
              <p className="text-xs text-[var(--text-muted)]">{t("dashboard.bulk.tagsHint")}</p>
              {parsedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {parsedTags.map((tag) => (
                    <TagBadge key={tag} tag={tag}>
                      {tag}
                    </TagBadge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() =>
              onApply({
                credentialMode,
                credentialId: credentialMode === "set" ? credentialId : undefined,
                groupMode,
                groupName: groupMode === "set" ? groupName.trim() : undefined,
                tagsMode,
                tags: parsedTags,
              })
            }
            disabled={applyDisabled}
          >
            {t("dashboard.bulk.apply")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ContextItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  title,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
        disabled
          ? "cursor-not-allowed text-[var(--text-muted)] opacity-60"
          : danger
          ? "text-[var(--danger)] hover:bg-[var(--danger)]/10"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function EmptyState({
  standaloneWindow,
  onImportSshConfig,
}: {
  standaloneWindow: boolean;
  onImportSshConfig: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="h-16 w-16 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center">
        <Server size={28} className="text-[var(--text-muted)]" />
      </div>
      <div className="text-center">
        <p className="font-medium text-[var(--text-primary)]">{t("dashboard.noHosts")}</p>
        <p className="text-sm text-[var(--text-muted)] mt-1">{t("dashboard.noHostsDescription")}</p>
      </div>
      <NewConnectionSplitButton
        size="md"
        standaloneWindow={standaloneWindow}
        onImportSshConfig={onImportSshConfig}
      />
    </div>
  );
}

function parseTagList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function applyTagMode(currentTags: string[], mode: BulkEditTagsMode, tags: string[]): string[] {
  if (mode === "keep") return currentTags;
  if (mode === "replace") return tags;
  if (mode === "add") return Array.from(new Set([...currentTags, ...tags]));
  if (mode === "clear") return [];
  return currentTags.filter((tag) => !tags.includes(tag));
}
