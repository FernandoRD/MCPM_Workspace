import { describe, expect, it } from "vitest";
import type { SessionTab } from "@/types";
import {
  parseSessionState,
  readPersistedSessionTabs,
  restoreSessionTabs,
  serializeSessionState,
} from "@/lib/sessionPersistence";

function savedTab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: "tab-1",
    type: "terminal",
    hostId: "host-1",
    hostLabel: "Production",
    hostAddress: "prod.example",
    status: "connected",
    panes: [{ id: "pane-1", status: "connected" }],
    splitDirection: "vertical",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("session persistence", () => {
  it("persists only safe saved-host layout metadata", () => {
    const raw = serializeSessionState([
      savedTab({
        connection: {
          source: "saved-host",
          protocol: "ssh",
          host: "prod.example",
          port: 22,
          username: "admin",
          authMethod: "password",
          password: "do-not-save",
          privateKeyContent: "PRIVATE KEY",
          passphrase: "secret",
        },
      }),
      savedTab({
        id: "quick-1",
        hostId: "quick-connect:quick-1",
        connection: {
          source: "quick-connect",
          protocol: "ssh",
          host: "temporary.example",
          port: 22,
          username: "temporary",
          authMethod: "password",
          password: "do-not-save",
        },
      }),
    ], "tab-1");

    expect(raw).not.toContain("password");
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain("temporary.example");

    const parsed = parseSessionState(raw);
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.activeTabId).toBe("tab-1");
    expect(parsed.tabs[0]).not.toHaveProperty("connection");
    expect(parsed.tabs[0]?.panes).toEqual([{ id: "pane-1" }]);
  });

  it("restores available hosts as disconnected and requires an explicit reconnect", () => {
    const raw = serializeSessionState([
      savedTab(),
      savedTab({ id: "tab-2", hostId: "deleted-host" }),
    ], "tab-1");
    const result = readPersistedSessionTabs(raw, ["host-1"]);

    expect(result.activeTabId).toBe("tab-1");
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).toMatchObject({
      id: "tab-1",
      status: "disconnected",
      requiresExplicitReconnect: true,
      panes: [{ id: "pane-1", status: "disconnected" }],
    });
  });

  it("does not crash on corrupted, unsupported, or partially invalid storage", () => {
    expect(parseSessionState("not-json").tabs).toEqual([]);
    expect(parseSessionState(JSON.stringify({ version: 99, tabs: [] })).tabs).toEqual([]);
    expect(parseSessionState(JSON.stringify({ version: 1, tabs: [{ id: "bad" }] })).tabs).toEqual([]);
    expect(restoreSessionTabs(parseSessionState(null))).toEqual([]);
  });

  it("normalizes duplicated panes and ignores panes on non-terminal tabs", () => {
    const terminal = savedTab({
      panes: [
        { id: "pane-1", status: "connected" },
        { id: "pane-1", status: "error" },
        { id: "pane-2", status: "disconnected" },
      ],
    });
    const rdp = savedTab({ id: "rdp-1", type: "rdp", panes: [{ id: "unexpected", status: "connected" }] });

    const parsed = parseSessionState(serializeSessionState([terminal, rdp], "rdp-1"));

    expect(parsed.tabs[0]?.panes).toEqual([{ id: "pane-1" }, { id: "pane-2" }]);
    expect(parsed.tabs[1]?.panes).toEqual([]);
  });
});
