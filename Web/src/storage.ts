/**
 * Client-side session storage.
 *
 * We use localStorage for now — fine for a basic-level prototype.
 * In the real spec, the device secret + signing key would live in
 * iOS Keychain / Android Keystore / web IndexedDB.
 */

export type Session = {
  did: string;
  uid: string;
  handle?: string | null;
  password: string;
  accessToken: string;
  expiresAt: string;
  displayName: string;
  colorHex: string;
};

const KEY = 'ghostline.session.v1';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
