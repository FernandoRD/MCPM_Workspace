import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import { TabBar } from "@/components/TabBar/TabBar";

export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <TabBar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
