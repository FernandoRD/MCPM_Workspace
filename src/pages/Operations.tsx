import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import {
  FolderKanban,
  Play,
  Save,
  Trash2,
  Pencil,
  PlugZap,
  Square,
  Layers3,
  Plus,
  WandSparkles,
  ChevronRight,
  Server,
  TerminalSquare,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSessionsStore } from "@/store/sessions";
import { useSettingsStore } from "@/store/settings";
import { useSshKeysStore } from "@/store/sshKeys";
import { useTunnelRuntimeStore } from "@/store/tunnelRuntime";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TagBadge } from "@/components/ui/TagBadge";
import { Textarea } from "@/components/ui/Textarea";
import {
  CommandSnippet,
  TunnelProfile,
  Workspace,
} from "@/types";
import {
  createEmptySnippet,
  createEmptyTunnelProfile,
  formatHostAddress,
  getSnippetScopeLabel,
  supportsRemoteExec,
  supportsSftp,
  supportsTunnels,
  runRemoteCommand,
  startTunnel,
  stopTunnel,
} from "@/lib/productivity";
import { sanitizeTunnelProfileInput } from "@/lib/inputSanitizers";
import { matchesHostSearch } from "@/lib/hostSearch";
import { launchTerminalSession } from "@/lib/sessionLauncher";
import { cn, formatDate } from "@/lib/utils";
import { buildSessionRoute, isStandaloneWindow } from "@/lib/windowMode";

interface BatchResult {
  hostId: string;
  hostLabel: string;
  status: "running" | "success" | "error";
  stdout: string;
  stderr: string;
  exitStatus?: number;
  durationMs?: number;
  error?: string;
}

interface SnippetDraft extends Omit<CommandSnippet, "id" | "createdAt" | "updatedAt"> {}
interface TunnelDraft extends Omit<TunnelProfile, "id" | "createdAt" | "updatedAt"> {}

function asNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function Operations() {
  const navigate = useNavigate();
  const location = useLocation();
  const hosts = useHostsStore((s) => s.hosts);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const getSshKey = useSshKeysStore((s) => s.getSshKey);
  const { settings, updateProductivity } = useSettingsStore();
  const tabs = useSessionsStore((s) => s.tabs);
  const openSession = useSessionsStore((s) => s.openSession);
  const openSftpTab = useSessionsStore((s) => s.openSftpTab);
  const runtimes = useTunnelRuntimeStore((s) => s.runtimes);
  const clearTunnelRuntime = useTunnelRuntimeStore((s) => s.clearTunnel);

  const locale = settings.locale;
  const sessionOpenMode = settings.terminal.sessionOpenMode;
  const standaloneWindow = isStandaloneWindow(location.search);
  const isPt = locale.startsWith("pt");
  const text = isPt
    ? {
        title: "Operações",
        subtitle: "Workspaces, snippets, túneis e execução em lote para operar vários ambientes com menos atrito.",
        phase: "Fase 9",
        availableHosts: "{{count}} hosts disponíveis",
        workspace: {
          title: "Workspaces",
          description: "Salve o conjunto atual de abas e restaure depois com um clique.",
          openTabs: "{{count}} abas abertas",
          supportedTabs: "{{count}} item(ns) compatíveis agora",
          nameLabel: "Nome do workspace",
          namePlaceholder: "Ex.: Operação produção",
          saveCurrent: "Salvar abas atuais",
          emptyTitle: "Nenhum workspace salvo",
          emptyDescription: "Abra algumas sessões de terminal ou SFTP e salve um conjunto para reutilizar depois.",
          updatedAt: "{{count}} item(ns) • atualizado em {{date}}",
          update: "Atualizar",
          open: "Abrir",
          deletedHost: "Host removido",
          incompatibleItem: "Incompatível com o protocolo atual",
          openSummary: "Workspace aberto com {{count}} item(ns).",
          openSkipped: "{{count}} item(ns) do workspace foram pulados por incompatibilidade de protocolo.",
          nothingToOpen: "Nenhum item compatível deste workspace pôde ser aberto.",
          requireTabs: "Abra pelo menos uma sessão para salvar um workspace.",
          saved: "Workspace salvo.",
          updated: "Workspace atualizado.",
          autoName: "Workspace {{count}}",
        },
        snippet: {
          title: "Snippets",
          description: "Comandos reutilizáveis com variáveis como ${host}, ${user}, ${port} e ${cwd}.",
          sshOnlyHint: "Nesta etapa, snippets operacionais executam apenas em hosts SSH.",
          nameLabel: "Nome do snippet",
          namePlaceholder: "Ex.: Reiniciar serviço",
          commandLabel: "Comando",
          commandPlaceholder: "sudo systemctl restart app && journalctl -u app -n 50",
          descriptionLabel: "Descrição",
          descriptionPlaceholder: "Quando usar e o que esse snippet faz",
          scopeLabel: "Escopo",
          scopeGlobal: "Global",
          scopeGroup: "Grupo",
          scopeHost: "Host",
          selectPlaceholder: "Selecionar...",
          tagsLabel: "Tags do snippet",
          tagsPlaceholder: "deploy, logs, manutenção",
          save: "Salvar snippet",
          update: "Atualizar snippet",
          cancel: "Cancelar edição",
          emptyTitle: "Nenhum snippet cadastrado",
          emptyDescription: "Crie comandos reutilizáveis para hosts específicos, grupos inteiros ou para uso global.",
          edit: "Editar",
          requireFields: "Informe nome e comando do snippet.",
          requireScope: "Selecione o host ou grupo do escopo do snippet.",
          unsupportedScope: "Snippets operacionais só podem apontar para hosts SSH ou grupos com ao menos um host SSH.",
          saved: "Snippet salvo.",
          updated: "Snippet atualizado.",
          scopeFallbackHost: "Host específico",
        },
        tunnel: {
          title: "Túneis e port forwarding",
          description: "Perfis persistidos para LocalForward, RemoteForward e DynamicForward (SOCKS5).",
          sshOnlyHint: "Túneis ainda estão disponíveis apenas para hosts SSH.",
          nameLabel: "Nome do túnel",
          namePlaceholder: "Ex.: Banco produção",
          hostLabel: "Host",
          hostPlaceholder: "Selecionar host...",
          typeLabel: "Tipo",
          localForward: "LocalForward",
          remoteForward: "RemoteForward",
          dynamicForward: "DynamicForward",
          bindAddress: "Bind address",
          bindPort: "Bind port",
          remoteDestination: "Destino remoto",
          remotePort: "Porta remota",
          localDestination: "Destino local",
          localPort: "Porta local",
          save: "Salvar túnel",
          update: "Atualizar túnel",
          cancel: "Cancelar edição",
          profilesTitle: "Perfis ativos e salvos",
          profilesDescription: "Inicie e pare túneis sem sair do app. O runtime atual fica visível com feedback ao vivo.",
          emptyTitle: "Nenhum túnel configurado",
          emptyDescription: "Crie perfis para bancos, painéis internos e proxies SOCKS antes de iniciar as conexões.",
          hostRemoved: "Host removido",
          start: "Iniciar",
          stop: "Parar",
          active: "Ativo",
          starting: "Iniciando",
          stopped: "Parado",
          error: "Erro",
          localHint: "Encaminhamento local em {{bind}} -> {{target}}",
          remoteHint: "Encaminhamento remoto em {{bind}} -> {{target}}",
          dynamicHint: "Proxy SOCKS5 em {{bind}}",
          fillRequired: "Preencha nome, host, endereço local e porta do túnel.",
          localNeedsDestination: "Túneis locais precisam de destino remoto.",
          remoteNeedsDestination: "Túneis remotos precisam de destino local.",
          saved: "Túnel salvo.",
          updated: "Túnel atualizado.",
          hostNotFound: "Host do túnel não encontrado.",
          hostUnsupported: "O host selecionado não suporta túneis neste protocolo.",
          unsupportedBadge: "Somente SSH",
          started: "Túnel {{label}} iniciado.",
          stoppedFeedback: "Túnel {{label}} finalizado.",
        },
        batch: {
          title: "Execução em lote",
          description: "Rode comandos em vários hosts e acompanhe a saída segmentada por servidor.",
          sshOnlyHint: "A execução em lote usa apenas hosts SSH nesta etapa.",
          selectFiltered: "Selecionar filtrados",
          clearSelection: "Limpar seleção",
          searchLabel: "Busca",
          searchPlaceholder: "Alias, host ou tag",
          groupLabel: "Grupo",
          tagLabel: "Tag",
          all: "Todos",
          emptyHosts: "Nenhum host encontrado para os filtros atuais.",
          snippetLabel: "Snippet",
          snippetPlaceholder: "Selecionar snippet...",
          snippetHint: "A execução em lote usa apenas snippets salvos. As variáveis ${host}, ${user}, ${port} e ${cwd} são renderizadas no backend por host.",
          snippetPreview: "Comando do snippet",
          execute: "Executar em lote",
          executing: "Executando...",
          selectedCount: "{{count}} host(s) selecionado(s)",
          emptyTitle: "Sem execuções ainda",
          emptyDescription: "Selecione hosts, escolha um snippet salvo e rode sua primeira operação em lote.",
          running: "Executando",
          ok: "OK",
          error: "Erro",
          viewHost: "Ver host",
          incompatibleHost: "Execução remota indisponível para este protocolo",
          stdout: "STDOUT",
          stderr: "STDERR",
          requireSnippet: "Selecione um snippet para a execução em lote.",
          requireHosts: "Selecione pelo menos um host para executar em lote.",
        },
      }
    : {
        title: "Operations",
        subtitle: "Workspaces, snippets, tunnels, and batch execution to operate across multiple environments with less friction.",
        phase: "Phase 9",
        availableHosts: "{{count}} available hosts",
        workspace: {
          title: "Workspaces",
          description: "Save the current set of tabs and restore it later with one click.",
          openTabs: "{{count}} open tabs",
          supportedTabs: "{{count}} compatible item(s) right now",
          nameLabel: "Workspace name",
          namePlaceholder: "Ex.: Production operations",
          saveCurrent: "Save current tabs",
          emptyTitle: "No saved workspaces",
          emptyDescription: "Open some terminal or SFTP sessions and save a set to reuse later.",
          updatedAt: "{{count}} item(s) • updated on {{date}}",
          update: "Update",
          open: "Open",
          deletedHost: "Removed host",
          incompatibleItem: "Incompatible with the current protocol",
          openSummary: "Workspace opened with {{count}} item(s).",
          openSkipped: "{{count}} workspace item(s) were skipped due to protocol incompatibility.",
          nothingToOpen: "No compatible item from this workspace could be opened.",
          requireTabs: "Open at least one session to save a workspace.",
          saved: "Workspace saved.",
          updated: "Workspace updated.",
          autoName: "Workspace {{count}}",
        },
        snippet: {
          title: "Snippets",
          description: "Reusable commands with variables like ${host}, ${user}, ${port}, and ${cwd}.",
          sshOnlyHint: "At this stage, operational snippets run only on SSH hosts.",
          nameLabel: "Snippet name",
          namePlaceholder: "Ex.: Restart service",
          commandLabel: "Command",
          commandPlaceholder: "sudo systemctl restart app && journalctl -u app -n 50",
          descriptionLabel: "Description",
          descriptionPlaceholder: "When to use it and what this snippet does",
          scopeLabel: "Scope",
          scopeGlobal: "Global",
          scopeGroup: "Group",
          scopeHost: "Host",
          selectPlaceholder: "Select...",
          tagsLabel: "Snippet tags",
          tagsPlaceholder: "deploy, logs, maintenance",
          save: "Save snippet",
          update: "Update snippet",
          cancel: "Cancel editing",
          emptyTitle: "No snippets yet",
          emptyDescription: "Create reusable commands for specific hosts, whole groups, or global use.",
          edit: "Edit",
          requireFields: "Provide a snippet name and command.",
          requireScope: "Select the host or group scope for the snippet.",
          unsupportedScope: "Operational snippets can only target SSH hosts or groups with at least one SSH host.",
          saved: "Snippet saved.",
          updated: "Snippet updated.",
          scopeFallbackHost: "Specific host",
        },
        tunnel: {
          title: "Tunnels and port forwarding",
          description: "Persistent profiles for LocalForward, RemoteForward, and DynamicForward (SOCKS5).",
          sshOnlyHint: "Tunnels are still available only for SSH hosts.",
          nameLabel: "Tunnel name",
          namePlaceholder: "Ex.: Production database",
          hostLabel: "Host",
          hostPlaceholder: "Select host...",
          typeLabel: "Type",
          localForward: "LocalForward",
          remoteForward: "RemoteForward",
          dynamicForward: "DynamicForward",
          bindAddress: "Bind address",
          bindPort: "Bind port",
          remoteDestination: "Remote destination",
          remotePort: "Remote port",
          localDestination: "Local destination",
          localPort: "Local port",
          save: "Save tunnel",
          update: "Update tunnel",
          cancel: "Cancel editing",
          profilesTitle: "Active and saved profiles",
          profilesDescription: "Start and stop tunnels without leaving the app. The current runtime is visible with live feedback.",
          emptyTitle: "No configured tunnels",
          emptyDescription: "Create profiles for databases, internal dashboards, and SOCKS proxies before starting connections.",
          hostRemoved: "Removed host",
          start: "Start",
          stop: "Stop",
          active: "Active",
          starting: "Starting",
          stopped: "Stopped",
          error: "Error",
          localHint: "Local forwarding on {{bind}} -> {{target}}",
          remoteHint: "Remote forwarding on {{bind}} -> {{target}}",
          dynamicHint: "SOCKS5 proxy on {{bind}}",
          fillRequired: "Fill in tunnel name, host, bind address, and bind port.",
          localNeedsDestination: "Local tunnels require a remote destination.",
          remoteNeedsDestination: "Remote tunnels require a local destination.",
          saved: "Tunnel saved.",
          updated: "Tunnel updated.",
          hostNotFound: "Tunnel host not found.",
          hostUnsupported: "The selected host does not support tunnels on this protocol.",
          unsupportedBadge: "SSH only",
          started: "Tunnel {{label}} started.",
          stoppedFeedback: "Tunnel {{label}} stopped.",
        },
        batch: {
          title: "Batch execution",
          description: "Run commands across multiple hosts and follow output segmented by server.",
          sshOnlyHint: "Batch execution uses only SSH hosts at this stage.",
          selectFiltered: "Select filtered",
          clearSelection: "Clear selection",
          searchLabel: "Search",
          searchPlaceholder: "Alias, host, or tag",
          groupLabel: "Group",
          tagLabel: "Tag",
          all: "All",
          emptyHosts: "No hosts found for the current filters.",
          snippetLabel: "Snippet",
          snippetPlaceholder: "Select snippet...",
          snippetHint: "Batch execution only uses saved snippets. Variables ${host}, ${user}, ${port}, and ${cwd} are rendered in the backend per host.",
          snippetPreview: "Snippet command",
          execute: "Run batch",
          executing: "Running...",
          selectedCount: "{{count}} host(s) selected",
          emptyTitle: "No executions yet",
          emptyDescription: "Select hosts, choose a saved snippet, and run your first batch operation.",
          running: "Running",
          ok: "OK",
          error: "Error",
          viewHost: "View host",
          incompatibleHost: "Remote execution unavailable for this protocol",
          stdout: "STDOUT",
          stderr: "STDERR",
          requireSnippet: "Select a snippet for batch execution.",
          requireHosts: "Select at least one host to run in batch.",
        },
      };

  const [workspaceName, setWorkspaceName] = useState("");
  const [snippetDraft, setSnippetDraft] = useState<SnippetDraft>(createEmptySnippet());
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
  const [tunnelDraft, setTunnelDraft] = useState<TunnelDraft>(createEmptyTunnelProfile(""));
  const [editingTunnelId, setEditingTunnelId] = useState<string | null>(null);
  const [batchSnippetId, setBatchSnippetId] = useState("");
  const [batchSelectedHostIds, setBatchSelectedHostIds] = useState<string[]>([]);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchGroupFilter, setBatchGroupFilter] = useState("");
  const [batchTagFilter, setBatchTagFilter] = useState("");
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const snippets = settings.productivity.snippets;
  const workspaces = settings.productivity.workspaces;
  const tunnels = settings.productivity.tunnels;
  const sshHosts = useMemo(() => hosts.filter((host) => host.protocol === "ssh"), [hosts]);
  const groups = [...new Set(sshHosts.map((host) => host.group).filter((group): group is string => !!group))].sort();
  const tags = [...new Set(sshHosts.flatMap((host) => host.tags ?? []).filter(Boolean))].sort();
  const execGroups = useMemo(
    () => [...new Set(sshHosts.map((host) => host.group).filter((group): group is string => !!group))].sort(),
    [sshHosts]
  );

  const hostNameResolver = (hostId: string) => hosts.find((host) => host.id === hostId)?.label;
  const selectedBatchSnippet = snippets.find((snippet) => snippet.id === batchSnippetId) ?? null;
  const snippetScopeHostOptions = useMemo(() => {
    if (!snippetDraft.scopeValue || snippetDraft.scopeType !== "host") return sshHosts;
    const selectedHost = hosts.find((host) => host.id === snippetDraft.scopeValue);
    if (!selectedHost || sshHosts.some((host) => host.id === selectedHost.id)) return sshHosts;
    return [selectedHost, ...sshHosts];
  }, [hosts, snippetDraft.scopeType, snippetDraft.scopeValue, sshHosts]);
  const snippetScopeGroupOptions = useMemo(() => {
    if (!snippetDraft.scopeValue || snippetDraft.scopeType !== "group" || execGroups.includes(snippetDraft.scopeValue)) {
      return execGroups;
    }
    return [snippetDraft.scopeValue, ...execGroups];
  }, [execGroups, snippetDraft.scopeType, snippetDraft.scopeValue]);

  const visibleBatchHosts = useMemo(
    () => sshHosts.filter((host) => {
      const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
      const matchesSearch = matchesHostSearch(host, batchSearch, credential);
      const matchesGroup = !batchGroupFilter || host.group === batchGroupFilter;
      const matchesTag = !batchTagFilter || host.tags.includes(batchTagFilter);
      return matchesSearch && matchesGroup && matchesTag;
    }),
    [sshHosts, getCredential, batchSearch, batchGroupFilter, batchTagFilter]
  );

  const activeSessionsSnapshot = tabs
    .filter((tab) => (tab.type === "terminal" || tab.type === "sftp") && tab.connection?.source !== "quick-connect")
    .map((tab) => ({ hostId: tab.hostId, type: tab.type }));

  const supportedWorkspaceItemCount = useMemo(
    () =>
      activeSessionsSnapshot.filter((item) => {
        const host = hosts.find((entry) => entry.id === item.hostId);
        if (!host) return false;
        if (item.type === "sftp") return supportsSftp(host);
        return true;
      }).length,
    [activeSessionsSnapshot, hosts]
  );

  useEffect(() => {
    setBatchSelectedHostIds((current) => current.filter((id) => sshHosts.some((host) => host.id === id)));
  }, [sshHosts]);

  useEffect(() => {
    if (editingTunnelId) return;
    setTunnelDraft((current) => {
      if (current.hostId && sshHosts.some((host) => host.id === current.hostId)) {
        return current;
      }
      return createEmptyTunnelProfile(sshHosts[0]?.id ?? "");
    });
  }, [editingTunnelId, sshHosts]);

  const setProductivity = (next: Partial<typeof settings.productivity>) => {
    updateProductivity({
      ...settings.productivity,
      ...next,
    });
  };

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const resetSnippetDraft = () => {
    setSnippetDraft(createEmptySnippet());
    setEditingSnippetId(null);
  };

  const resetTunnelDraft = () => {
    setTunnelDraft(createEmptyTunnelProfile(sshHosts[0]?.id ?? ""));
    setEditingTunnelId(null);
  };

  const saveWorkspaceFromTabs = (workspaceId?: string) => {
    const items = activeSessionsSnapshot;
    if (items.length === 0) {
      showFeedback("error", text.workspace.requireTabs);
      return;
    }

    const now = new Date().toISOString();
    const name = workspaceName.trim()
      || workspaces.find((workspace) => workspace.id === workspaceId)?.name
      || text.workspace.autoName.replace("{{count}}", String(workspaces.length + 1));
    const workspace: Workspace = {
      id: workspaceId ?? uuidv4(),
      name,
      items,
      createdAt: workspaces.find((entry) => entry.id === workspaceId)?.createdAt ?? now,
      updatedAt: now,
    };

    const nextWorkspaces = workspaceId
      ? workspaces.map((entry) => (entry.id === workspaceId ? workspace : entry))
      : [workspace, ...workspaces];

    setProductivity({ workspaces: nextWorkspaces });
    setWorkspaceName("");
    showFeedback("success", workspaceId ? text.workspace.updated : text.workspace.saved);
  };

  const openWorkspace = async (workspace: Workspace) => {
    const createdRoutes: string[] = [];
    let skippedItems = 0;

    for (const item of workspace.items) {
      const host = hosts.find((entry) => entry.id === item.hostId);
      if (!host) {
        skippedItems += 1;
        continue;
      }
      const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
      const hostAddress = formatHostAddress(host, credential);

      if (item.type === "terminal") {
        const route = await launchTerminalSession({
          hostId: host.id,
          hostLabel: host.label,
          hostAddress,
          openMode: sessionOpenMode,
          openSession,
          standaloneWindow,
        });
        if (route) createdRoutes.push(route);
        continue;
      }

      if (!supportsSftp(host)) {
        skippedItems += 1;
        continue;
      }
      const id = openSftpTab(host.id, host.label, hostAddress);
      createdRoutes.push(
        buildSessionRoute("sftp", id, {
          standalone: standaloneWindow,
          hostId: standaloneWindow ? host.id : undefined,
          hostLabel: standaloneWindow ? host.label : undefined,
          hostAddress: standaloneWindow ? hostAddress : undefined,
        })
      );
    }

    if (createdRoutes.length === 0) {
      showFeedback("error", text.workspace.nothingToOpen);
      return;
    }

    if (skippedItems > 0) {
      showFeedback("error", text.workspace.openSkipped.replace("{{count}}", String(skippedItems)));
    } else {
      showFeedback("success", text.workspace.openSummary.replace("{{count}}", String(createdRoutes.length)));
    }

    if (createdRoutes[0]) {
      navigate(createdRoutes[0]);
    }
  };

  const deleteWorkspace = (workspaceId: string) => {
    setProductivity({ workspaces: workspaces.filter((workspace) => workspace.id !== workspaceId) });
  };

  const saveSnippet = () => {
    if (!snippetDraft.label.trim() || !snippetDraft.command.trim()) {
      showFeedback("error", text.snippet.requireFields);
      return;
    }
    if (snippetDraft.scopeType !== "global" && !snippetDraft.scopeValue) {
      showFeedback("error", text.snippet.requireScope);
      return;
    }
    if (snippetDraft.scopeType === "host") {
      const scopeHost = hosts.find((host) => host.id === snippetDraft.scopeValue);
      if (!scopeHost || !supportsRemoteExec(scopeHost)) {
        showFeedback("error", text.snippet.unsupportedScope);
        return;
      }
    }
    if (snippetDraft.scopeType === "group") {
      const hasExecCapableHost = sshHosts.some((host) => host.group === snippetDraft.scopeValue);
      if (!hasExecCapableHost) {
        showFeedback("error", text.snippet.unsupportedScope);
        return;
      }
    }

    const now = new Date().toISOString();
    const snippet: CommandSnippet = {
      id: editingSnippetId ?? uuidv4(),
      createdAt: snippets.find((entry) => entry.id === editingSnippetId)?.createdAt ?? now,
      updatedAt: now,
      ...snippetDraft,
      label: snippetDraft.label.trim(),
      command: snippetDraft.command,
      description: snippetDraft.description?.trim() || undefined,
      tags: snippetDraft.tags,
    };

    const nextSnippets = editingSnippetId
      ? snippets.map((entry) => (entry.id === editingSnippetId ? snippet : entry))
      : [snippet, ...snippets];

    setProductivity({ snippets: nextSnippets });
    resetSnippetDraft();
    showFeedback("success", editingSnippetId ? text.snippet.updated : text.snippet.saved);
  };

  const editSnippet = (snippet: CommandSnippet) => {
    setEditingSnippetId(snippet.id);
    setSnippetDraft({
      label: snippet.label,
      command: snippet.command,
      description: snippet.description,
      scopeType: snippet.scopeType,
      scopeValue: snippet.scopeValue,
      tags: snippet.tags,
    });
  };

  const deleteSnippet = (snippetId: string) => {
    setProductivity({ snippets: snippets.filter((snippet) => snippet.id !== snippetId) });
    if (editingSnippetId === snippetId) resetSnippetDraft();
  };

  const saveTunnelProfile = () => {
    const sanitizedDraft = sanitizeTunnelProfileInput(tunnelDraft);
    if (!sanitizedDraft.label || !sanitizedDraft.hostId || !sanitizedDraft.bindAddress || !sanitizedDraft.bindPort) {
      showFeedback("error", text.tunnel.fillRequired);
      return;
    }
    const tunnelHost = hosts.find((entry) => entry.id === sanitizedDraft.hostId);
    if (!tunnelHost || !supportsTunnels(tunnelHost)) {
      showFeedback("error", text.tunnel.hostUnsupported);
      return;
    }
    if (sanitizedDraft.kind === "local" && (!sanitizedDraft.destinationHost || !sanitizedDraft.destinationPort)) {
      showFeedback("error", text.tunnel.localNeedsDestination);
      return;
    }
    if (sanitizedDraft.kind === "remote" && (!sanitizedDraft.localHost || !sanitizedDraft.localPort)) {
      showFeedback("error", text.tunnel.remoteNeedsDestination);
      return;
    }

    const now = new Date().toISOString();
    const profile: TunnelProfile = {
      id: editingTunnelId ?? uuidv4(),
      createdAt: tunnels.find((entry) => entry.id === editingTunnelId)?.createdAt ?? now,
      updatedAt: now,
      ...sanitizedDraft,
    };

    const nextTunnels = editingTunnelId
      ? tunnels.map((entry) => (entry.id === editingTunnelId ? profile : entry))
      : [profile, ...tunnels];

    setProductivity({ tunnels: nextTunnels });
    resetTunnelDraft();
    showFeedback("success", editingTunnelId ? text.tunnel.updated : text.tunnel.saved);
  };

  const editTunnel = (profile: TunnelProfile) => {
    setEditingTunnelId(profile.id);
    setTunnelDraft({
      label: profile.label,
      hostId: profile.hostId,
      kind: profile.kind,
      bindAddress: profile.bindAddress,
      bindPort: profile.bindPort,
      destinationHost: profile.destinationHost,
      destinationPort: profile.destinationPort,
      localHost: profile.localHost,
      localPort: profile.localPort,
      autoStart: profile.autoStart,
    });
  };

  const deleteTunnel = (profileId: string) => {
    setProductivity({ tunnels: tunnels.filter((profile) => profile.id !== profileId) });
    clearTunnelRuntime(profileId);
    if (editingTunnelId === profileId) resetTunnelDraft();
  };

  const handleStartTunnel = async (profile: TunnelProfile) => {
    const host = hosts.find((entry) => entry.id === profile.hostId);
    if (!host) {
      showFeedback("error", text.tunnel.hostNotFound);
      return;
    }
    if (!supportsTunnels(host)) {
      showFeedback("error", text.tunnel.hostUnsupported);
      return;
    }
    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const sshKey = credential?.keyId ? getSshKey(credential.keyId) : undefined;
    try {
      await startTunnel({
        profile,
        host,
        credential,
        sshKey,
        sshSettings: settings.ssh,
      });
      showFeedback("success", text.tunnel.started.replace("{{label}}", profile.label));
    } catch (error) {
      showFeedback("error", String(error));
    }
  };

  const handleStopTunnel = async (profile: TunnelProfile) => {
    try {
      await stopTunnel(profile.id);
      showFeedback("success", text.tunnel.stoppedFeedback.replace("{{label}}", profile.label));
    } catch (error) {
      showFeedback("error", String(error));
    }
  };

  const toggleBatchHost = (hostId: string) => {
    setBatchSelectedHostIds((current) => current.includes(hostId)
      ? current.filter((id) => id !== hostId)
      : [...current, hostId]);
  };

  const executeBatch = async () => {
    if (!batchSnippetId) {
      showFeedback("error", text.batch.requireSnippet);
      return;
    }

    const selectedHosts = hosts.filter((host) => batchSelectedHostIds.includes(host.id) && supportsRemoteExec(host));
    if (selectedHosts.length === 0) {
      showFeedback("error", text.batch.requireHosts);
      return;
    }

    setBatchRunning(true);
    setBatchResults(selectedHosts.map((host) => ({
      hostId: host.id,
      hostLabel: host.label,
      status: "running",
      stdout: "",
      stderr: "",
    })));

    for (const host of selectedHosts) {
      try {
        const result = await runRemoteCommand({
          host,
          hostId: host.id,
          snippetId: batchSnippetId,
          cwd: "~",
        });

        setBatchResults((current) => current.map((entry) =>
          entry.hostId === host.id
            ? {
                ...entry,
                status: result.exit_status === 0 ? "success" : "error",
                stdout: result.stdout,
                stderr: result.stderr,
                exitStatus: result.exit_status,
                durationMs: result.duration_ms,
              }
            : entry
        ));
      } catch (error) {
        setBatchResults((current) => current.map((entry) =>
          entry.hostId === host.id
            ? {
                ...entry,
                status: "error",
                error: String(error),
              }
            : entry
        ));
      }
    }

    setBatchRunning(false);
  };

  const tunnelKindLabel = (kind: TunnelProfile["kind"]) => {
    if (kind === "local") return text.tunnel.localForward;
    if (kind === "remote") return text.tunnel.remoteForward;
    return text.tunnel.dynamicForward;
  };

  const renderRuntimeBadge = (profileId: string) => {
    const runtime = runtimes[profileId];
    if (!runtime) return <Badge variant="default">{text.tunnel.stopped}</Badge>;
    if (runtime.status === "running") return <Badge variant="success">{text.tunnel.active}</Badge>;
    if (runtime.status === "starting") return <Badge variant="warning">{text.tunnel.starting}</Badge>;
    if (runtime.status === "error") return <Badge variant="danger">{text.tunnel.error}</Badge>;
    return <Badge variant="default">{text.tunnel.stopped}</Badge>;
  };

  const runtimeMessage = (profile: TunnelProfile) => {
    const runtime = runtimes[profile.id];
    if (!runtime) return null;
    if (runtime.status === "error" && runtime.message) return runtime.message;
    const bind = `${profile.bindAddress}:${profile.bindPort}`;
    if (profile.kind === "local" && profile.destinationHost && profile.destinationPort) {
      return text.tunnel.localHint
        .replace("{{bind}}", bind)
        .replace("{{target}}", `${profile.destinationHost}:${profile.destinationPort}`);
    }
    if (profile.kind === "remote" && profile.localHost && profile.localPort) {
      return text.tunnel.remoteHint
        .replace("{{bind}}", bind)
        .replace("{{target}}", `${profile.localHost}:${profile.localPort}`);
    }
    return text.tunnel.dynamicHint.replace("{{bind}}", bind);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4 gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{text.title}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{text.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Badge variant="accent">{text.phase}</Badge>
          <span>{text.availableHosts.replace("{{count}}", String(hosts.length))}</span>
        </div>
      </div>

      {feedback && (
        <div className={cn(
          "mx-6 mt-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm",
          feedback.type === "success"
            ? "border-[var(--success)]/30 bg-[var(--success)]/15 text-[var(--success)]"
            : "border-[var(--danger)]/30 bg-[var(--danger)]/15 text-[var(--danger)]"
        )}>
          {feedback.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {feedback.message}
        </div>
      )}

      <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
        <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                  <FolderKanban size={18} className="text-[var(--accent)]" />
                  {text.workspace.title}
                </h2>
                <p className="text-sm text-[var(--text-muted)] mt-1">{text.workspace.description}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Badge variant="default">{text.workspace.openTabs.replace("{{count}}", String(activeSessionsSnapshot.length))}</Badge>
                <Badge variant="accent">{text.workspace.supportedTabs.replace("{{count}}", String(supportedWorkspaceItemCount))}</Badge>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <Input
                label={text.workspace.nameLabel}
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder={text.workspace.namePlaceholder}
              />
              <Button onClick={() => saveWorkspaceFromTabs()} className="md:mb-[2px]">
                <Save size={14} />
                {text.workspace.saveCurrent}
              </Button>
            </div>

            <div className="space-y-3">
              {workspaces.length === 0 ? (
                <EmptyState
                  title={text.workspace.emptyTitle}
                  description={text.workspace.emptyDescription}
                />
              ) : (
                workspaces.map((workspace) => {
                  const compatibleCount = workspace.items.filter((item) => {
                    const host = hosts.find((entry) => entry.id === item.hostId);
                    if (!host) return false;
                    return item.type === "sftp" ? supportsSftp(host) : true;
                  }).length;
                  return (
                  <div key={workspace.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{workspace.name}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {text.workspace.updatedAt
                            .replace("{{count}}", String(workspace.items.length))
                            .replace("{{date}}", formatDate(workspace.updatedAt, locale))}
                        </p>
                        <div className="mt-2">
                          <Badge variant={compatibleCount > 0 ? "accent" : "warning"}>
                            {text.workspace.supportedTabs.replace("{{count}}", String(compatibleCount))}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => saveWorkspaceFromTabs(workspace.id)}>
                          <Save size={13} />
                          {text.workspace.update}
                        </Button>
                        <Button size="sm" onClick={() => openWorkspace(workspace)} disabled={compatibleCount === 0}>
                          <Play size={13} />
                          {text.workspace.open}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteWorkspace(workspace.id)}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {workspace.items.map((item, index) => {
                        const host = hosts.find((entry) => entry.id === item.hostId);
                        const incompatible = !!host && item.type === "sftp" && !supportsSftp(host);
                        return (
                          <span
                            key={`${workspace.id}:${item.hostId}:${index}`}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs",
                              incompatible
                                ? "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
                                : "border-[var(--border)] text-[var(--text-secondary)]"
                            )}
                            title={incompatible ? text.workspace.incompatibleItem : undefined}
                          >
                            {item.type === "sftp" ? <Layers3 size={11} /> : <TerminalSquare size={11} />}
                            {host?.label ?? text.workspace.deletedHost}
                            {host && <Badge variant={host.protocol === "ssh" ? "accent" : "warning"}>{host.protocol.toUpperCase()}</Badge>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )})
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                <WandSparkles size={18} className="text-[var(--accent)]" />
                {text.snippet.title}
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">{text.snippet.description}</p>
              <p className="text-xs text-[var(--text-muted)] mt-2">{text.snippet.sshOnlyHint}</p>
            </div>

            <div className="grid gap-3">
              <Input
                label={text.snippet.nameLabel}
                value={snippetDraft.label}
                onChange={(event) => setSnippetDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder={text.snippet.namePlaceholder}
              />
              <Textarea
                label={text.snippet.commandLabel}
                value={snippetDraft.command}
                onChange={(event) => setSnippetDraft((current) => ({ ...current, command: event.target.value }))}
                rows={4}
                placeholder={text.snippet.commandPlaceholder}
              />
              <Input
                label={text.snippet.descriptionLabel}
                value={snippetDraft.description ?? ""}
                onChange={(event) => setSnippetDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder={text.snippet.descriptionPlaceholder}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  label={text.snippet.scopeLabel}
                  value={snippetDraft.scopeType}
                  onChange={(event) => setSnippetDraft((current) => ({
                    ...current,
                    scopeType: event.target.value as SnippetDraft["scopeType"],
                    scopeValue: undefined,
                  }))}
                >
                  <option value="global">{text.snippet.scopeGlobal}</option>
                  <option value="group">{text.snippet.scopeGroup}</option>
                  <option value="host">{text.snippet.scopeHost}</option>
                </Select>
                {snippetDraft.scopeType !== "global" && (
                  <Select
                    label={snippetDraft.scopeType === "group" ? text.snippet.scopeGroup : text.snippet.scopeHost}
                    value={snippetDraft.scopeValue ?? ""}
                    onChange={(event) => setSnippetDraft((current) => ({ ...current, scopeValue: event.target.value }))}
                  >
                    <option value="">{text.snippet.selectPlaceholder}</option>
                    {snippetDraft.scopeType === "group"
                      ? snippetScopeGroupOptions.map((group) => <option key={group} value={group}>{group}</option>)
                      : snippetScopeHostOptions.map((host) => <option key={host.id} value={host.id}>{host.label}</option>)}
                  </Select>
                )}
              </div>
              <Input
                label={text.snippet.tagsLabel}
                value={(snippetDraft.tags ?? []).join(", ")}
                onChange={(event) => setSnippetDraft((current) => ({
                  ...current,
                  tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                }))}
                placeholder={text.snippet.tagsPlaceholder}
              />
              <div className="flex items-center gap-2">
                <Button onClick={saveSnippet}>
                  {editingSnippetId ? <Pencil size={14} /> : <Plus size={14} />}
                  {editingSnippetId ? text.snippet.update : text.snippet.save}
                </Button>
                {editingSnippetId && (
                  <Button variant="secondary" onClick={resetSnippetDraft}>{text.snippet.cancel}</Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {snippets.length === 0 ? (
                <EmptyState
                  title={text.snippet.emptyTitle}
                  description={text.snippet.emptyDescription}
                />
              ) : (
                snippets.map((snippet) => (
                  <div key={snippet.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[var(--text-primary)]">{snippet.label}</p>
                          <Badge variant="accent">
                            {getSnippetScopeLabel(snippet, hostNameResolver, {
                              global: text.snippet.scopeGlobal,
                              group: text.snippet.scopeGroup,
                              host: text.snippet.scopeFallbackHost,
                            })}
                          </Badge>
                        </div>
                        {snippet.description && (
                          <p className="text-xs text-[var(--text-muted)] mt-1">{snippet.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => editSnippet(snippet)}>
                          <Pencil size={13} />
                          {text.snippet.edit}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteSnippet(snippet.id)}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                    <pre className="mt-3 overflow-auto rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
                      {snippet.command}
                    </pre>
                    {snippet.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {snippet.tags.map((tag) => <TagBadge key={`${snippet.id}:${tag}`} tag={tag} />)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                <PlugZap size={18} className="text-[var(--accent)]" />
                {text.tunnel.title}
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">{text.tunnel.description}</p>
              <p className="text-xs text-[var(--text-muted)] mt-2">{text.tunnel.sshOnlyHint}</p>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label={text.tunnel.nameLabel}
                  value={tunnelDraft.label}
                  onChange={(event) => setTunnelDraft((current) => ({ ...current, label: event.target.value }))}
                  placeholder={text.tunnel.namePlaceholder}
                />
                <Select
                  label={text.tunnel.hostLabel}
                  value={tunnelDraft.hostId}
                  onChange={(event) => setTunnelDraft((current) => ({ ...current, hostId: event.target.value }))}
                >
                  <option value="">{text.tunnel.hostPlaceholder}</option>
                  {sshHosts.map((host) => (
                    <option key={host.id} value={host.id}>{host.label}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Select
                  label={text.tunnel.typeLabel}
                  value={tunnelDraft.kind}
                  onChange={(event) => setTunnelDraft((current) => ({ ...current, kind: event.target.value as TunnelDraft["kind"] }))}
                >
                  <option value="local">{text.tunnel.localForward}</option>
                  <option value="remote">{text.tunnel.remoteForward}</option>
                  <option value="dynamic">{text.tunnel.dynamicForward}</option>
                </Select>
                <Input
                  label={text.tunnel.bindAddress}
                  value={tunnelDraft.bindAddress}
                  onChange={(event) => setTunnelDraft((current) => ({ ...current, bindAddress: event.target.value }))}
                />
                <Input
                  label={text.tunnel.bindPort}
                  type="number"
                  value={String(tunnelDraft.bindPort)}
                  onChange={(event) => setTunnelDraft((current) => ({ ...current, bindPort: asNumber(event.target.value) }))}
                />
              </div>

              {tunnelDraft.kind === "local" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label={text.tunnel.remoteDestination}
                    value={tunnelDraft.destinationHost ?? ""}
                    onChange={(event) => setTunnelDraft((current) => ({ ...current, destinationHost: event.target.value }))}
                    placeholder="127.0.0.1"
                  />
                  <Input
                    label={text.tunnel.remotePort}
                    type="number"
                    value={String(tunnelDraft.destinationPort ?? 0)}
                    onChange={(event) => setTunnelDraft((current) => ({ ...current, destinationPort: asNumber(event.target.value) }))}
                  />
                </div>
              )}

              {tunnelDraft.kind === "remote" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label={text.tunnel.localDestination}
                    value={tunnelDraft.localHost ?? "127.0.0.1"}
                    onChange={(event) => setTunnelDraft((current) => ({ ...current, localHost: event.target.value }))}
                  />
                  <Input
                    label={text.tunnel.localPort}
                    type="number"
                    value={String(tunnelDraft.localPort ?? 0)}
                    onChange={(event) => setTunnelDraft((current) => ({ ...current, localPort: asNumber(event.target.value) }))}
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={saveTunnelProfile}>
                  {editingTunnelId ? <Pencil size={14} /> : <Plus size={14} />}
                  {editingTunnelId ? text.tunnel.update : text.tunnel.save}
                </Button>
                {editingTunnelId && (
                  <Button variant="secondary" onClick={resetTunnelDraft}>{text.tunnel.cancel}</Button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{text.tunnel.profilesTitle}</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">{text.tunnel.profilesDescription}</p>
            </div>

            <div className="space-y-3">
              {tunnels.length === 0 ? (
                <EmptyState
                  title={text.tunnel.emptyTitle}
                  description={text.tunnel.emptyDescription}
                />
              ) : (
                tunnels.map((profile) => {
                  const host = hosts.find((entry) => entry.id === profile.hostId);
                  const runtime = runtimes[profile.id];
                  const hostSupportsTunnel = !!host && supportsTunnels(host);
                  const isRunning = runtime?.status === "running" || runtime?.status === "starting";
                  return (
                    <div key={profile.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{profile.label}</p>
                            {renderRuntimeBadge(profile.id)}
                            <Badge variant="default">{tunnelKindLabel(profile.kind)}</Badge>
                            {host && <Badge variant={host.protocol === "ssh" ? "accent" : "warning"}>{host.protocol.toUpperCase()}</Badge>}
                            {host && !hostSupportsTunnel && <Badge variant="warning">{text.tunnel.unsupportedBadge}</Badge>}
                          </div>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            {host?.label ?? text.tunnel.hostRemoved} • {profile.bindAddress}:{profile.bindPort}
                            {profile.kind === "local" && profile.destinationHost && profile.destinationPort ? ` -> ${profile.destinationHost}:${profile.destinationPort}` : ""}
                            {profile.kind === "remote" && profile.localHost && profile.localPort ? ` -> ${profile.localHost}:${profile.localPort}` : ""}
                          </p>
                          {runtime && (
                            <p className="text-xs text-[var(--text-muted)] mt-2">{runtimeMessage(profile)}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {isRunning ? (
                            <Button variant="secondary" size="sm" onClick={() => handleStopTunnel(profile)}>
                              <Square size={12} />
                              {text.tunnel.stop}
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => handleStartTunnel(profile)} disabled={!hostSupportsTunnel}>
                              <Play size={12} />
                              {text.tunnel.start}
                            </Button>
                          )}
                          <Button variant="secondary" size="sm" onClick={() => editTunnel(profile)}>
                            <Pencil size={12} />
                            {text.snippet.edit}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteTunnel(profile.id)}>
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 space-y-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
                <Server size={18} className="text-[var(--accent)]" />
                {text.batch.title}
              </h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">{text.batch.description}</p>
              <p className="text-xs text-[var(--text-muted)] mt-2">{text.batch.sshOnlyHint}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setBatchSelectedHostIds(visibleBatchHosts.map((host) => host.id))}>
                {text.batch.selectFiltered}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBatchSelectedHostIds([])}>
                {text.batch.clearSelection}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.35fr]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  label={text.batch.searchLabel}
                  value={batchSearch}
                  onChange={(event) => setBatchSearch(event.target.value)}
                  placeholder={text.batch.searchPlaceholder}
                />
                <Select
                  label={text.batch.groupLabel}
                  value={batchGroupFilter}
                  onChange={(event) => setBatchGroupFilter(event.target.value)}
                >
                  <option value="">{text.batch.all}</option>
                  {groups.map((group) => <option key={group} value={group}>{group}</option>)}
                </Select>
                <Select
                  label={text.batch.tagLabel}
                  value={batchTagFilter}
                  onChange={(event) => setBatchTagFilter(event.target.value)}
                >
                  <option value="">{text.batch.all}</option>
                  {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </Select>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] max-h-[320px] overflow-auto">
                {visibleBatchHosts.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                    {text.batch.emptyHosts}
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border)]">
                    {visibleBatchHosts.map((host) => {
                      const checked = batchSelectedHostIds.includes(host.id);
                      return (
                        <label key={host.id} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBatchHost(host.id)}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-[var(--text-primary)]">{host.label}</p>
                              {host.group && <Badge>{host.group}</Badge>}
                              <Badge variant="accent">{host.protocol.toUpperCase()}</Badge>
                            </div>
                            <p className="text-xs text-[var(--text-muted)] mt-1">{host.host}:{host.port}</p>
                            {host.tags.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {host.tags.map((tag) => (
                                  <TagBadge key={`${host.id}:${tag}`} tag={tag} compact />
                                ))}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <Select
                id="batch-snippet"
                label={text.batch.snippetLabel}
                value={batchSnippetId}
                onChange={(event) => setBatchSnippetId(event.target.value)}
              >
                <option value="">{text.batch.snippetPlaceholder}</option>
                {snippets.map((snippet) => (
                  <option key={snippet.id} value={snippet.id}>
                    {snippet.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-[var(--text-muted)]">
                {text.batch.snippetHint}
              </p>
              {selectedBatchSnippet && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {text.batch.snippetPreview}
                  </p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
                    {selectedBatchSnippet.command}
                  </pre>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={executeBatch} disabled={batchRunning || batchSelectedHostIds.length === 0 || !batchSnippetId}>
                  {batchRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {batchRunning ? text.batch.executing : text.batch.execute}
                </Button>
                <span className="text-xs text-[var(--text-muted)]">
                  {text.batch.selectedCount.replace("{{count}}", String(batchSelectedHostIds.length))}
                </span>
              </div>

              <div className="space-y-3">
                {batchResults.length === 0 ? (
                  <EmptyState
                    title={text.batch.emptyTitle}
                    description={text.batch.emptyDescription}
                  />
                ) : (
                  batchResults.map((result) => (
                    <div key={result.hostId} className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{result.hostLabel}</p>
                            {result.status === "running" && <Badge variant="warning">{text.batch.running}</Badge>}
                            {result.status === "success" && <Badge variant="success">{text.batch.ok}</Badge>}
                            {result.status === "error" && <Badge variant="danger">{text.batch.error}</Badge>}
                          </div>
                          {(result.exitStatus !== undefined || result.durationMs !== undefined) && (
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                              exit {result.exitStatus ?? "-"} • {(result.durationMs ?? 0)} ms
                            </p>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/hosts/${result.hostId}`)}>
                          {text.batch.viewHost}
                          <ChevronRight size={12} />
                        </Button>
                      </div>

                      {result.error && (
                        <div className="mt-3 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
                          {result.error}
                        </div>
                      )}

                      {result.stdout && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-[var(--text-muted)] mb-2">{text.batch.stdout}</p>
                          <pre className="overflow-auto rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
                            {result.stdout}
                          </pre>
                        </div>
                      )}

                      {result.stderr && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-[var(--danger)] mb-2">{text.batch.stderr}</p>
                          <pre className="overflow-auto rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--danger)] whitespace-pre-wrap">
                            {result.stderr}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-primary)] px-4 py-8 text-center">
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>
    </div>
  );
}
