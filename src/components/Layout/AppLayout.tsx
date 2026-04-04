import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import { TabBar } from "@/components/TabBar/TabBar";
import { isStandaloneWindow } from "@/lib/windowMode";
import { useUIStore } from "@/store/uiStore";

export function AppLayout() {
  const location = useLocation();
  const standalone = isStandaloneWindow(location.search);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [openCommandPalette]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {!standalone && <Sidebar />}
      <div className="flex flex-1 flex-col min-w-0">
        <TabBar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={commandPaletteOpen} onClose={closeCommandPalette} />
    </div>
  );
}
