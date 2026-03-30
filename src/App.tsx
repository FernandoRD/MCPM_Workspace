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

export default function App() {
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
