import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionStatus: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionStatus !== null) return permissionStatus;
  permissionStatus = await isPermissionGranted();
  if (!permissionStatus) {
    const result = await requestPermission();
    permissionStatus = result === "granted";
  }
  return permissionStatus;
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    sendNotification({ title, body });
  } catch {
    // notificações não são críticas — falha silenciosa
  }
}
