import { invoke } from "@tauri-apps/api/core";

export interface InternalRdpViewerLaunchResult {
  launcherName: string;
  executable: string;
  argumentsPreview: string;
  message: string;
  settingsSource?: string | null;
}

export interface RdpMonitorLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor?: number;
}

interface LaunchInternalRdpViewerParams {
  sessionId: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  options?: {
    fullscreen?: boolean;
    width?: number;
    height?: number;
    dynamicResolution?: boolean;
    multimon?: boolean;
    clipboard?: boolean;
    audioMode?: string;
    certificateMode?: string;
    preferredLinuxClient?: string;
    monitors?: RdpMonitorLayout[];
  };
}

export async function launchInternalRdpViewer({
  sessionId,
  host,
  port,
  username,
  password,
  options,
}: LaunchInternalRdpViewerParams): Promise<InternalRdpViewerLaunchResult> {
  return invoke<InternalRdpViewerLaunchResult>("rdp_launch_internal_viewer", {
    sessionId,
    host,
    port,
    username: username?.trim() || null,
    password: password ?? null,
    options: options ?? null,
  });
}
