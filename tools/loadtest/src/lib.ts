import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import http from "k6/http";

import { OpenDmSchema } from "../../../client/src/gen/v1/conversations_pb.ts";
import {
  AuthenticateSchema,
  type Envelope,
  EnvelopeSchema,
} from "../../../client/src/gen/v1/envelope_pb.ts";
import { SendMessageSchema } from "../../../client/src/gen/v1/messages_pb.ts";

export const API = __ENV.API ?? "http://127.0.0.1:7200";
export const WS_URL = API.replace(/^http/, "ws") + "/ws";
export const USERS = Number(__ENV.USERS ?? 500);
const PASSWORD = "LoadTest1!";
const JSON_HEADERS = { "Content-Type": "application/json" };

export const identity = (i: number) => ({
  email: `loaduser${i}@load.test`,
  username: `loaduser${i}`,
});

export type Session = {
  userId: bigint;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
};

const device = { name: "k6", platform: "web" };

function parseSession(body: string): Session {
  const s = JSON.parse(body) as {
    access_token: string;
    access_expires_at: number;
    refresh_token: string;
    user: { id: string | number };
  };
  return {
    userId: BigInt(s.user.id),
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAtMs: s.access_expires_at * 1000,
  };
}

export function register(i: number) {
  const { email, username } = identity(i);
  const res = http.post(
    `${API}/auth/register`,
    JSON.stringify({ email, password: PASSWORD, device }),
    { headers: JSON_HEADERS, tags: { name: "POST /auth/register" } },
  );
  if (res.status !== 200 && res.status !== 201) return res.status;
  const s = parseSession(res.body as string);
  const named = http.put(`${API}/me/username`, JSON.stringify({ username }), {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${s.accessToken}` },
    tags: { name: "PUT /me/username" },
  });
  return named.status;
}

export function login(i: number): Session {
  const res = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: identity(i).email, password: PASSWORD, device }),
    { headers: JSON_HEADERS, tags: { name: "POST /auth/login" } },
  );
  if (res.status !== 200) throw new Error(`login ${identity(i).email}: ${res.status}`);
  return parseSession(res.body as string);
}

export function fresh(s: Session): Session {
  if (s.expiresAtMs - Date.now() > 120_000) return s;
  const res = http.post(`${API}/auth/refresh`, JSON.stringify({ refresh_token: s.refreshToken }), {
    headers: JSON_HEADERS,
    tags: { name: "POST /auth/refresh" },
  });
  if (res.status !== 200) throw new Error(`refresh: ${res.status}`);
  return parseSession(res.body as string);
}

export function encode(id: bigint, payload: Envelope["payload"]): ArrayBuffer {
  const b = toBinary(EnvelopeSchema, create(EnvelopeSchema, { id, payload }));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export const decode = (data: ArrayBuffer) => fromBinary(EnvelopeSchema, new Uint8Array(data));

export const authenticate = (accessToken: string): Envelope["payload"] => ({
  case: "authenticate",
  value: create(AuthenticateSchema, { accessToken }),
});

export const openDm = (username: string): Envelope["payload"] => ({
  case: "openDm",
  value: create(OpenDmSchema, { username }),
});

const utf8 = new TextEncoder();

export const sendMessage = (
  conversationId: bigint,
  text: string,
  nonce: string,
): Envelope["payload"] => ({
  case: "sendMessage",
  value: create(SendMessageSchema, { conversationId, content: utf8.encode(text), nonce }),
});
