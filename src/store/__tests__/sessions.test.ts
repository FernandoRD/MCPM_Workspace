import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installWindow(search: string, initialValue: string | null = null) {
  const localStorage = {
    getItem: vi.fn(() => initialValue),
    setItem: vi.fn(),
  };

  vi.stubGlobal("window", {
    location: { search },
    localStorage,
  });

  return localStorage;
}

describe("sessions store persistence", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists saved-host tabs in the main window", async () => {
    const localStorage = installWindow("");
    const { useSessionsStore } = await import("@/store/sessions");

    useSessionsStore.getState().openSession("host-1", "Production", "prod.example");

    expect(localStorage.setItem).toHaveBeenCalledOnce();
    const payload = JSON.parse(localStorage.setItem.mock.calls[0]?.[1] ?? "{}");
    expect(payload.tabs).toHaveLength(1);
    expect(payload.tabs[0]).toMatchObject({ hostId: "host-1", hostAddress: "prod.example" });
  });

  it("never overwrites main-window persistence from a standalone window", async () => {
    const localStorage = installWindow("?standalone=1");
    const { useSessionsStore } = await import("@/store/sessions");

    useSessionsStore.getState().openSession("host-1", "Production", "prod.example");

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("restores saved tabs as inert sessions after filtering deleted hosts", async () => {
    const raw = JSON.stringify({
      version: 1,
      activeTabId: "tab-1",
      tabs: [
        {
          id: "tab-1",
          type: "terminal",
          hostId: "host-1",
          hostLabel: "Production",
          hostAddress: "prod.example",
          panes: [{ id: "pane-1" }],
          splitDirection: "horizontal",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "tab-deleted",
          type: "sftp",
          hostId: "deleted-host",
          hostLabel: "Deleted",
          hostAddress: "deleted.example",
          panes: [],
          splitDirection: "horizontal",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    installWindow("", raw);
    const { useSessionsStore } = await import("@/store/sessions");

    useSessionsStore.getState().restorePersistedTabs(["host-1"]);

    expect(useSessionsStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: "tab-1",
        status: "disconnected",
        requiresExplicitReconnect: true,
      }),
    ]);
  });
});
