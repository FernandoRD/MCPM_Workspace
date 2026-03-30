import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/Layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { HostEditor } from "@/pages/HostEditor";
import { Settings } from "@/pages/Settings";
import { Sync } from "@/pages/Sync";
import { Backup } from "@/pages/Backup";
import { TerminalPage } from "@/pages/TerminalPage";
import { Credentials } from "@/pages/Credentials";
import { CredentialEditor } from "@/pages/CredentialEditor";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { useCredentialsStore } from "@/store/credentials";

export default function App() {
  const [ready, setReady] = useState(false);
  const initHosts = useHostsStore((s) => s.init);
  const initSettings = useSettingsStore((s) => s.init);
  const initCredentials = useCredentialsStore((s) => s.init);

  useEffect(() => {
    Promise.all([initSettings(), initHosts(), initCredentials()]).finally(() =>
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
          <Route path="settings" element={<Settings />} />
          <Route path="sync" element={<Sync />} />
          <Route path="backup" element={<Backup />} />
          <Route path="credentials" element={<Credentials />} />
          <Route path="credentials/new" element={<CredentialEditor />} />
          <Route path="credentials/:id" element={<CredentialEditor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
