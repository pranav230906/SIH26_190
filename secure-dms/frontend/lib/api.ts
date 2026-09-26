import type { ApiErrorBody, TokenResponse } from "@/lib/types";
import { clearSession, getAccessToken, getRefreshToken, setTokens } from "@/lib/session";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

export async function apiFetch<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const isAuthExchange = path === "/api/auth/login" || path === "/api/auth/refresh" || path === "/api/auth/logout";

  if (!isAuthExchange && !getAccessToken() && getRefreshToken() && retry) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      throw new ApiClientError(401, "unauthorized", "Your session has ended. Sign in again.");
    }
  }

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const bodyIsForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !bodyIsForm && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const accessToken = getAccessToken();
  if (accessToken && !isAuthExchange) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "network_error", "Unable to reach the document service. Confirm the API is running.");
  }

  if (response.status === 401 && retry && !isAuthExchange && getRefreshToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, options, false);
    }
    throw new ApiClientError(401, "unauthorized", "Your session has ended. Sign in again.");
  }

  if (!response.ok) {
    throw await readError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function apiFetchBlob(path: string, retry = true): Promise<{ blob: Blob; filename: string | null }> {
  if (!getAccessToken() && getRefreshToken() && retry) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      throw new ApiClientError(401, "unauthorized", "Your session has ended. Sign in again.");
    }
  }
  const headers = new Headers();
  headers.set("Accept", "*/*");
  const accessToken = getAccessToken();
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { headers, cache: "no-store" });
  } catch {
    throw new ApiClientError(0, "network_error", "Unable to reach the document service. Confirm the API is running.");
  }
  if (response.status === 401 && retry && getRefreshToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetchBlob(path, false);
    }
    throw new ApiClientError(401, "unauthorized", "Your session has ended. Sign in again.");
  }
  if (!response.ok) {
    throw await readError(response);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] ?? null };
}

export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (percent: number) => void): Promise<T> {
  return sendUpload<T>(path, form, onProgress, true);
}

function sendUpload<T>(path: string, form: FormData, onProgress: (percent: number) => void, retry: boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.setRequestHeader("Accept", "application/json");
    const accessToken = getAccessToken();
    if (accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => {
      reject(new ApiClientError(0, "network_error", "Unable to reach the document service. Confirm the API is running."));
    };
    xhr.onload = () => {
      if (xhr.status === 401 && retry && getRefreshToken()) {
        refreshAccessToken()
          .then((refreshed) => {
            if (!refreshed) {
              reject(new ApiClientError(401, "unauthorized", "Your session has ended. Sign in again."));
              return;
            }
            resolve(sendUpload<T>(path, form, onProgress, false));
          })
          .catch(() => {
            reject(new ApiClientError(401, "unauthorized", "Your session has ended. Sign in again."));
          });
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(errorFromXhr(xhr));
        return;
      }
      resolve(JSON.parse(xhr.responseText) as T);
    };
    xhr.send(form);
  });
}

function errorFromXhr(xhr: XMLHttpRequest): ApiClientError {
  try {
    const body = JSON.parse(xhr.responseText) as ApiErrorBody;
    return new ApiClientError(xhr.status, body.error?.code ?? "error", body.error?.message || "The request could not be completed.");
  } catch {
    return new ApiClientError(xhr.status, "error", "The request could not be completed.");
  }
}

export async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!response.ok) {
      clearSession();
      return false;
    }
    const data = (await response.json()) as TokenResponse;
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

async function readError(response: Response): Promise<ApiClientError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    const details = body.error?.details;
    const detailText =
      details && details.length > 0
        ? details.map((detail) => `${detail.field}: ${detail.message}`).join(" ")
        : null;
    const message = detailText || body.error?.message || "The request could not be completed.";
    return new ApiClientError(response.status, body.error?.code ?? "error", message);
  } catch {
    return new ApiClientError(response.status, "error", "The request could not be completed.");
  }
}
