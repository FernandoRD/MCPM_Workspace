import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const packageLockPath = path.join(rootDir, "package-lock.json");
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const cargoLockPath = path.join(rootDir, "src-tauri", "Cargo.lock");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

if (!version || typeof version !== "string") {
  throw new Error("package.json precisa conter um campo version válido.");
}

syncPackageLock(version);
syncCargoToml(version);
syncCargoLock(version);

console.log(`Version sync completed: ${version}`);

function syncPackageLock(nextVersion) {
  if (!fs.existsSync(packageLockPath)) return;

  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
  packageLock.version = nextVersion;

  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = nextVersion;
  }

  fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
}

function syncCargoToml(nextVersion) {
  const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
  const updatedCargoToml = cargoToml.replace(
    /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m,
    `$1${nextVersion}$3`
  );

  if (updatedCargoToml === cargoToml) {
    throw new Error("Não foi possível localizar a versão do pacote em src-tauri/Cargo.toml.");
  }

  fs.writeFileSync(cargoTomlPath, updatedCargoToml);
}

function syncCargoLock(nextVersion) {
  if (!fs.existsSync(cargoLockPath)) return;

  const cargoLock = fs.readFileSync(cargoLockPath, "utf8");
  const updatedCargoLock = cargoLock.replace(
    /(name = "ssh-vault"\nversion = ")([^"]+)(")/,
    `$1${nextVersion}$3`
  );

  if (updatedCargoLock === cargoLock) {
    throw new Error("Não foi possível localizar o pacote ssh-vault em src-tauri/Cargo.lock.");
  }

  fs.writeFileSync(cargoLockPath, updatedCargoLock);
}
