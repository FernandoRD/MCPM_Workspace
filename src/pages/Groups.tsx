import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers, Pencil, Trash2, Check, X, Server, Plus } from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function Groups() {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const updateHost = useHostsStore((s) => s.updateHost);
  const savedGroups = useSettingsStore((s) => s.settings.groups);
  const updateGroups = useSettingsStore((s) => s.updateGroups);

  // Grupos derivados dos hosts
  const groupMap = hosts.reduce<Record<string, number>>((acc, h) => {
    if (h.group) acc[h.group] = (acc[h.group] ?? 0) + 1;
    return acc;
  }, {});

  // União: grupos com hosts + grupos salvos manualmente (sem hosts ainda)
  const allGroups = [
    ...new Set([...Object.keys(groupMap), ...savedGroups]),
  ].sort((a, b) => a.localeCompare(b));

  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [createError, setCreateError] = useState("");

  const startEdit = (name: string) => {
    setCreating(false);
    setEditingGroup(name);
    setEditValue(name);
  };

  const cancelEdit = () => {
    setEditingGroup(null);
    setEditValue("");
  };

  const confirmRename = () => {
    const newName = editValue.trim();
    if (!newName || newName === editingGroup) { cancelEdit(); return; }

    hosts
      .filter((h) => h.group === editingGroup)
      .forEach((h) => updateHost(h.id, { group: newName }));

    updateGroups(
      savedGroups
        .map((g) => (g === editingGroup ? newName : g))
        .filter((g, i, arr) => arr.indexOf(g) === i)
    );

    cancelEdit();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    hosts
      .filter((h) => h.group === deleteTarget)
      .forEach((h) => updateHost(h.id, { group: undefined }));
    updateGroups(savedGroups.filter((g) => g !== deleteTarget));
    setDeleteTarget(null);
  };

  const startCreate = () => {
    cancelEdit();
    setCreating(true);
    setNewGroupName("");
    setCreateError("");
  };

  const cancelCreate = () => {
    setCreating(false);
    setNewGroupName("");
    setCreateError("");
  };

  const confirmCreate = () => {
    const name = newGroupName.trim();
    if (!name) { setCreateError(t("groups.nameRequired")); return; }
    if (allGroups.includes(name)) { setCreateError(t("groups.nameExists")); return; }
    updateGroups([...savedGroups, name]);
    cancelCreate();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("groups.title")}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {t("groups.description")}
          </p>
        </div>
        <Button size="sm" onClick={startCreate}>
          <Plus size={14} />
          {t("groups.newGroup")}
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-xl flex flex-col gap-2">
          {/* Linha de criação inline */}
          {creating && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border-focus)] bg-[var(--bg-secondary)] px-4 py-3">
              <Layers size={16} className="text-[var(--accent)] shrink-0" />
              <div className="flex-1 flex flex-col gap-1">
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => { setNewGroupName(e.target.value); setCreateError(""); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmCreate();
                    if (e.key === "Escape") cancelCreate();
                  }}
                  placeholder={t("groups.namePlaceholder")}
                  className="h-8 w-full rounded-md border border-[var(--border-focus)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
                {createError && (
                  <p className="text-xs text-[var(--danger)]">{createError}</p>
                )}
              </div>
              <button
                onClick={confirmCreate}
                className="flex h-7 w-7 items-center justify-center rounded text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors"
              >
                <Check size={14} />
              </button>
              <button
                onClick={cancelCreate}
                className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {allGroups.length === 0 && !creating ? (
            <EmptyState onNew={startCreate} />
          ) : (
            allGroups.map((name) => {
              const count = groupMap[name] ?? 0;
              return (
                <div
                  key={name}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3"
                >
                  <Layers size={16} className="text-[var(--accent)] shrink-0" />

                  {editingGroup === name ? (
                    <>
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmRename();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        className="flex-1 h-8 rounded-md border border-[var(--border-focus)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] focus:outline-none"
                      />
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
                      <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                        {name}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <Server size={11} />
                        {t("groups.hostCount", { count })}
                      </span>
                      <button
                        onClick={() => startEdit(name)}
                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                        title={t("common.edit")}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(name)}
                        className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] transition-colors"
                        title={t("common.delete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal de confirmação de exclusão */}
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
              count: deleteTarget ? (groupMap[deleteTarget] ?? 0) : 0,
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
      <Button onClick={onNew}>
        <Plus size={14} />
        {t("groups.newGroup")}
      </Button>
    </div>
  );
}
