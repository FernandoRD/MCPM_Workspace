import { SshKey } from "@/types";

/**
 * Resolves any runtime secrets for an SSH key.
 * Currently the passphrase is stored directly on the SshKey object,
 * so this is a simple passthrough. In the future this could fetch
 * passphrases from the OS keychain.
 */
export async function resolveSshKeySecrets(key?: SshKey): Promise<SshKey | undefined> {
  return key;
}
