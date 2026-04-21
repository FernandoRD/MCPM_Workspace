import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Pencil, Trash2, Check, X, Server, Plus, FolderTree } from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  buildGroupTree,
  collectAllGroupPaths,
  flattenGroupTree,
  getGroupLeafName,
  getGroupParentPath,
  isGroupInTree,
  joinGroupPath,
  normalizeGroupPath,
  renameGroupPath,
} from "@/lib/groups";

export function Groups() {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const updateHost = useHostsStore((s) => s.updateHost);
  const savedGroups = useSettingsStore((s) => s.settings.groups);
  const updateGroups = useSettingsStore((s) => s.updateGroups);

  const allGroups = useMemo(
    () =>
      collectAllGroupPaths([
        ...hosts.map((host) => host.group),
        ...savedGroups,
      ]),
    [hosts, savedGroups]
  );

  const flattenedGroups = useMemo(
    () => flattenGroupTree(buildGroupTree(allGroups)),
    [allGroups]
  );

  const groupCount = useMemo(
    () =>
      allGroups.reduce<Record<string, number>>((acc, groupPath) => {
        acc[groupPath] = hosts.filter((host) => isGroupInTree(host.group, groupPath)).length;
        return acc;
      }, {}),
    [allGroups, hosts]
  );

  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingParent, setCreatingParent] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [createError, setCreateError] = useState("");

  const startEdit = (path: string) => {
    setCreating(false);
    setCreatingParent(null);
    setEditingGroup(path);
    setEditValue(getGroupLeafName(path));
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingGroup(null);
    setEditValue("");
    setEditError("");
  };

  const confirmRename = () => {
    if (!editingGroup) return;

    const normalizedLeaf = normalizeGroupPath(editValue);
    if (!normalizedLeaf) {
      setEditError(t("groups.nameRequired"));
      return;
    }

    const parentPath = getGroupParentPath(editingGroup);
    const renamedPath = joinGroupPath(parentPath, normalizedLeaf);
    if (!renamedPath || renamedPath === editingGroup) {
      cancelEdit();
      return;
    }

    if (allGroups.includes(renamedPath)) {
      setEditError(t("groups.nameExists"));
      return;
    }

    hosts
      .filter((host) => isGroupInTree(host.group, editingGroup))
      .forEach((host) => {
        if (!host.group) return;
        updateHost(host.id, { group: renameGroupPath(host.group, editingGroup, renamedPath) });
      });

    updateGroups(
      Array.from(
        new Set(
          savedGroups.map((groupPath) =>
            isGroupInTree(groupPath, editingGroup)
              ? renameGroupPath(groupPath, editingGroup, renamedPath)
              : groupPath
          )
        )
      )
    );

    cancelEdit();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;

    hosts
      .filter((host) => isGroupInTree(host.group, deleteTarget))
      .forEach((host) => updateHost(host.id, { group: undefined }));

    updateGroups(savedGroups.filter((groupPath) => !isGroupInTree(groupPath, deleteTarget)));
    setDeleteTarget(null);
  };

  const startCreate = (parentPath: string | null = null) => {
    cancelEdit();
    setCreating(true);
    setCreatingParent(parentPath);
    setNewGroupName("");
    setCreateError("");
  };

  const cancelCreate = () => {
    setCreating(false);
    setCreatingParent(null);
    setNewGroupName("");
    setCreateError("");
  };

  const confirmCreate = () => {
    const nextPath = joinGroupPath(creatingParent, newGroupName);
    if (!nextPath) {
      setCreateError(t("groups.nameRequired"));
      return;
    }

    if (allGroups.includes(nextPath)) {
      setCreateError(t("groups.nameExists"));
      return;
    }

    updateGroups([...savedGroups, nextPath]);
    cancelCreate();
  };

  const deleteCount = deleteTarget
    ? hosts.filter((host) => isGroupInTree(host.group, deleteTarget)).length
    : 0;

  const deleteChildrenCount = deleteTarget
    ? allGroups.filter((groupPath) => groupPath !== deleteTarget && isGroupInTree(groupPath, deleteTarget)).length
    : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("groups.title")}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {t("groups.description")}
          </p>
        </div>
        <Button size="sm" onClick={() => startCreate(null)}>
          <Plus size={14} />
          {t("groups.newGroup")}
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-3xl flex flex-col gap-2">
          {creating && (
            <CreateGroupRow
              parentPath={creatingParent}
              value={newGroupName}
              error={createError}
              onChange={(value) => {
                setNewGroupName(value);
                setCreateError("");
              }}
              onConfirm={confirmCreate}
              onCancel={cancelCreate}
            />
          )}

          {flattenedGroups.length === 0 && !creating ? (
            <EmptyState onNew={() => startCreate(null)} />
          ) : (
            flattenedGroups.map((group) => (
              <div
                key={group.path}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3"
              >
                <div
                  className="flex min-w-0 flex-1 items-center gap-3"
                  style={{ paddingLeft: `${group.depth * 18}px` }}
                >
                  <FolderTree size={16} className="text-[var(--accent)] shrink-0" />

                  {editingGroup === group.path ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(event) => {
                          setEditValue(event.target.value);
                          setEditError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") confirmRename();
                          if (event.key === "Escape") cancelEdit();
                        }}
                        className="h-8 w-full rounded-md border border-[var(--border-focus)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] focus:outline-none"
                      />
                      {editError && (
                        <p className="text-xs text-[var(--danger)]">{editError}</p>
                      )}
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {group.name}
                      </p>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {group.path}
                      </p>
                    </div>
                  )}
                </div>

                {editingGroup === group.path ? (
                  <>
                    <button
                      onClick={confirmRename}
                      className="flex h-7 w-7 items-center justify-center rounded text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <Server size={11} />
                      {t("groups.hostCount", { count: groupCount[group.path] ?? 0 })}
                    </span>
                    <button
                      onClick={() => startCreate(group.path)}
                      className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                      title={t("groups.addSubgroup")}
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      onClick={() => startEdit(group.path)}
                      className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                      title={t("common.edit")}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(group.path)}
                      className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] transition-colors"
                      title={t("common.delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t("groups.deleteTitle")}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--text-secondary)]">
            {t("groups.deleteConfirm", { name: deleteTarget })}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {t("groups.deleteWarning", {
              count: deleteCount,
              childrenCount: deleteChildrenCount,
            })}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="bg-[var(--danger)] hover:bg-[var(--danger)]/90 text-white"
              onClick={confirmDelete}
            >
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CreateGroupRow({
  parentPath,
  value,
  error,
  onChange,
  onConfirm,
  onCancel,
}: {
  parentPath: string | null;
  value: string;
  error: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border-focus)] bg-[var(--bg-secondary)] px-4 py-3">
      <Layers size={16} className="text-[var(--accent)] shrink-0" />
      <div className="flex-1 flex flex-col gap-1">
        <p className="text-xs text-[var(--text-muted)]">
          {parentPath
            ? t("groups.creatingInside", { parent: parentPath })
            : t("groups.creatingRoot")}
        </p>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm();
            if (event.key === "Escape") onCancel();
          }}
          placeholder={t("groups.namePlaceholder")}
          className="h-8 w-full rounded-md border border-[var(--border-focus)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
        />
        {error && (
          <p className="text-xs text-[var(--danger)]">{error}</p>
        )}
      </div>
      <button
        onClick={onConfirm}
        className="flex h-7 w-7 items-center justify-center rounded text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors"
      >
        <Check size={14} />
      </button>
      <button
        onClick={onCancel}
        className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="h-16 w-16 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center">
        <Layers size={28} className="text-[var(--text-muted)]" />
      </div>
      <div className="text-center">
        <p className="font-medium text-[var(--text-primary)]">{t("groups.noGroups")}</p>
        <p className="text-sm text-[var(--text-muted)] mt-1">{t("groups.noGroupsDescription")}</p>
      </div>
      <Button size="sm" onClick={onNew}>
        <Plus size={14} />
        {t("groups.newGroup")}
      </Button>
    </div>
  );
}
