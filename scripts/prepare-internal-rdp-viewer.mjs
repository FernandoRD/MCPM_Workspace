import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const manifestPath = path.join(projectRoot, "experiments", "internal-rdp-client", "Cargo.toml");
const targetDir = path.join(projectRoot, "src-tauri", "resources", "internal-rdp-client");
const executableName = process.platform === "win32" ? "viewer_mvp.exe" : "viewer_mvp";
const sourceBinary = path.join(
  projectRoot,
  "experiments",
  "internal-rdp-client",
  "target",
  "release",
  executableName
);
const targetBinary = path.join(targetDir, executableName);

fs.mkdirSync(targetDir, { recursive: true });

const result = spawnSync(
  "cargo",
  ["build", "--manifest-path", manifestPath, "--bin", "viewer_mvp", "--release"],
  {
    stdio: "inherit",
    cwd: projectRoot,
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.copyFileSync(sourceBinary, targetBinary);
if (process.platform !== "win32") {
  fs.chmodSync(targetBinary, 0o755);
}

console.log(`Bundled internal RDP viewer prepared at ${path.relative(projectRoot, targetBinary)}`);
