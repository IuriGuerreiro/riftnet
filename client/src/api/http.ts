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

// Only one refresh at a time, even if many requests need it.
let inFlight: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  inFlight ??= (async () => {
    const refreshToken = useAuth.getState().refreshToken;
    if (!refreshToken) return false;
    try {
      const res = await send("/auth/refresh", { method: "POST", body: { refresh_token: refreshToken } }, false);
      const session = await parse<Session>(res);
      useAuth.getState().setSession(session);
      return true;
    } catch {
      useAuth.getState().clear(); // refresh failed: back to login
      return false;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
