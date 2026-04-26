let sessionMasterPassword: string | null = null;

export function setSessionMasterPassword(password: string): void {
  sessionMasterPassword = password;
}

export function getSessionMasterPassword(): string | null {
  return sessionMasterPassword;
}

export function clearSessionMasterPassword(): void {
  sessionMasterPassword = null;
}
