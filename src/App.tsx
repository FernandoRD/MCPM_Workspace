import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/Layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { HostEditor } from "@/pages/HostEditor";
import { Settings } from "@/pages/Settings";
import { Sync } from "@/pages/Sync";
import { Backup } from "@/pages/Backup";
import { TerminalPage } from "@/pages/TerminalPage";
import { SftpPage } from "@/pages/SftpPage";
import { RdpPage } from "@/pages/RdpPage";
import { Credentials } from "@/pages/Credentials";
import { CredentialEditor } from "@/pages/CredentialEditor";
import { SshKeys } from "@/pages/SshKeys";
import { SshKeyEditor } from "@/pages/SshKeyEditor";
import { Groups } from "@/pages/Groups";
import { ConnectionLog } from "@/pages/ConnectionLog";
import { Operations } from "@/pages/Operations";
import { Health } from "@/pages/Health";
import { About } from "@/pages/About";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { useConnectionLogsStore } from "@/store/connectionLogs";
import { useAutoSync } from "@/hooks/useAutoSync";

export default function App() {
  const [ready, setReady] = useState(false);
  useAutoSync();
  const initHosts = useHostsStore((s) => s.init);
  const initSettings = useSettingsStore((s) => s.init);
  const initCredentials = useCredentialsStore((s) => s.init);
  const initSshKeys = useSshKeysStore((s) => s.init);
  const initConnectionLogs = useConnectionLogsStore((s) => s.init);

  useEffect(() => {
    Promise.all([initSettings(), initHosts(), initCredentials(), initSshKeys(), initConnectionLogs()]).finally(() =>
      setReady(true)
    );
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "var(--bg-primary)",
          color: "var(--text-muted)",
          fontSize: "14px",
        }}
      >
        Carregando...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="hosts/new" element={<HostEditor />} />
          <Route path="hosts/:id" element={<HostEditor />} />
          <Route path="terminal/:tabId" element={<TerminalPage />} />
          <Route path="sftp/:tabId" element={<SftpPage />} />
          <Route path="rdp/:tabId" element={<RdpPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="sync" element={<Sync />} />
          <Route path="backup" element={<Backup />} />
          <Route path="credentials" element={<Credentials />} />
          <Route path="credentials/new" element={<CredentialEditor />} />
          <Route path="credentials/:id" element={<CredentialEditor />} />
          <Route path="ssh-keys" element={<SshKeys />} />
          <Route path="ssh-keys/new" element={<SshKeyEditor />} />
          <Route path="ssh-keys/:id" element={<SshKeyEditor />} />
          <Route path="groups" element={<Groups />} />
          <Route path="connection-log" element={<ConnectionLog />} />
          <Route path="operations" element={<Operations />} />
          <Route path="health" element={<Health />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
