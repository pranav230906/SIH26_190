const ACCESS_KEY = "secure_dms_access_token";
const REFRESH_KEY = "secure_dms_refresh_token";

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage;
}

export function getAccessToken(): string | null {
  return storage()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return storage()?.getItem(REFRESH_KEY) ?? null;
}

export function setTokens(accessToken: string, refreshToken: string): void {
  const store = storage();
  if (!store) {
    return;
  }
  store.setItem(ACCESS_KEY, accessToken);
  store.setItem(REFRESH_KEY, refreshToken);
}

export function clearSession(): void {
  const store = storage();
  store?.removeItem(ACCESS_KEY);
  store?.removeItem(REFRESH_KEY);
}

export function hasSession(): boolean {
  return Boolean(getAccessToken() || getRefreshToken());
}
