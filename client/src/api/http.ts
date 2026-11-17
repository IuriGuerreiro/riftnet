import { platform } from "../platform";
import { useAuth } from "../stores/auth";
import type { ApiErrorBody, Session } from "./types";

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
  raw?: Blob;
  headers?: Record<string, string>;
  auth?: boolean;
}

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
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.raw !== undefined) headers["Content-Type"] = "application/octet-stream";
  const token = useAuth.getState().accessToken;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  return fetch(platform.httpUrl + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? res.statusText);
  }
  return data as T;
}

export async function freshAccessToken(): Promise<string | null> {
  await refreshIfExpiring();
  return useAuth.getState().accessToken;
}

async function refreshIfExpiring() {
  const { accessExpiresAt, refreshToken } = useAuth.getState();
  if (refreshToken && accessExpiresAt && accessExpiresAt - Date.now() / 1000 < 30) {
    await refresh();
  }
}

let inFlight: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  const startedWith = useAuth.getState().refreshToken;
  inFlight ??= withRefreshLock(() => doRefresh(startedWith)).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(startedWith: string | null): Promise<boolean> {
  await useAuth.persist.rehydrate();
  const refreshToken = useAuth.getState().refreshToken;
  if (!refreshToken) return false;
  if (refreshToken !== startedWith) return true;

  try {
    const res = await send(
      "/auth/refresh",
      { method: "POST", body: { refresh_token: refreshToken } },
      false,
    );
    useAuth.getState().setSession(await parse<Session>(res));
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.code === "refresh_superseded") {
      await useAuth.persist.rehydrate();
      return useAuth.getState().refreshToken !== refreshToken;
    }
    if (err instanceof ApiError && err.status === 401) useAuth.getState().clear();
    return false;
  }
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!("locks" in navigator)) return fn();
  return navigator.locks.request("auth-refresh", fn);
}
