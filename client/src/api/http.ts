import { platform } from "../platform";
import { useAuth } from "../stores/auth";
import type { ApiErrorBody, Session } from "./types";

// Thrown for any non-2xx response. `code` is the api's error code
// (e.g. "username_taken"), handy for showing the right message.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean; // send the access token (default true)
}

// Small fetch wrapper: JSON in/out, bearer token, one automatic refresh on 401.
export async function http<T>(path: string, opts: Options = {}): Promise<T> {
  const { auth = true } = opts;
  if (auth) await refreshIfExpiring();

  let res = await send(path, opts, auth);
  if (res.status === 401 && auth && (await refresh())) {
    res = await send(path, opts, auth);
  }
  return parse<T>(res);
}

function send(path: string, opts: Options, auth: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const token = useAuth.getState().accessToken;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  return fetch(platform.httpUrl + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? res.statusText);
  }
  return data as T;
}

// Refresh a bit before the access token expires, so requests don't fail.
async function refreshIfExpiring() {
  const { accessExpiresAt, refreshToken } = useAuth.getState();
  if (refreshToken && accessExpiresAt && accessExpiresAt - Date.now() / 1000 < 30) {
    await refresh();
  }
}

// Only one refresh at a time: within this tab (`inFlight`) and across tabs
// (Web Locks). Tabs share tokens through localStorage, so if two tabs refreshed
// with the same token, the server would see it used twice.
let inFlight: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  const startedWith = useAuth.getState().refreshToken;
  inFlight ??= withRefreshLock(() => doRefresh(startedWith)).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(startedWith: string | null): Promise<boolean> {
  // Another tab may have refreshed while we waited for the lock: reload from storage.
  await useAuth.persist.rehydrate();
  const refreshToken = useAuth.getState().refreshToken;
  if (!refreshToken) return false;
  if (refreshToken !== startedWith) return true; // someone else already did it

  try {
    const res = await send("/auth/refresh", { method: "POST", body: { refresh_token: refreshToken } }, false);
    useAuth.getState().setSession(await parse<Session>(res));
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.code === "refresh_superseded") {
      // Lost a race with another request: the newer token is (or soon will be) in storage.
      await useAuth.persist.rehydrate();
      return useAuth.getState().refreshToken !== refreshToken;
    }
    // Only a real rejection (401: expired, revoked, reused) means "log in again".
    // Offline, 429 or a 5xx is temporary: keep the tokens and let the caller retry.
    if (err instanceof ApiError && err.status === 401) useAuth.getState().clear();
    return false;
  }
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  // Web Locks: supported by all current browsers and Tauri webviews. Fall back
  // to the in-tab guard only if missing.
  if (!("locks" in navigator)) return fn();
  return navigator.locks.request("auth-refresh", fn);
}
