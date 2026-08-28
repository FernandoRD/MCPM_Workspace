import { invoke } from "@tauri-apps/api/core";
import { AppSettings, Credential, HostEntry, SshKey } from "@/types";
import { useCredentialsStore } from "@/store/credentials";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { useSshKeysStore } from "@/store/sshKeys";
import { logFrontendError } from "@/lib/logger";

export interface PortableStateSnapshot {
  hosts: HostEntry[];
  credentials: Credential[];
  sshKeys: SshKey[];
  settings: AppSettings;
}

export interface ApplyPortableStateSummary {
  databaseCommitted: boolean;
  hosts: number;
  credentials: number;
  sshKeys: number;
  settings: number;
  rdpMirror: {
    attempted: boolean;
    succeeded: boolean;
    error?: string;
  };
}

/**
 * Persiste um snapshot completo em uma única transação e só então publica o
 * novo estado nas stores. Se o backend falhar, o Zustand permanece inalterado.
 */
export async function applyPortableStateTransaction(
  snapshot: PortableStateSnapshot
): Promise<ApplyPortableStateSummary> {
  const summary = await invoke<ApplyPortableStateSummary>("db_apply_portable_state", {
    payload: snapshot,
  });

  if (!summary.databaseCommitted) {
    throw new Error("O backend não confirmou a transação do estado portátil");
  }

  useHostsStore.setState({ hosts: snapshot.hosts });
  useCredentialsStore.setState({ credentials: snapshot.credentials });
  useSshKeysStore.setState({ sshKeys: snapshot.sshKeys });
  useSettingsStore.getState().applyCommittedSettings(snapshot.settings);

  if (summary.rdpMirror.attempted && !summary.rdpMirror.succeeded) {
    logFrontendError(
      "portableState.rdpMirror",
      "O estado foi confirmado, mas o espelho de configurações RDP falhou",
      summary.rdpMirror.error
    );
  }

  return summary;
}
