import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AuthenticateSchema, EnvelopeSchema, type Envelope } from "../gen/v1/envelope_pb";
import type { User } from "../gen/v1/users_pb";
import { platform } from "../platform";

type Payload = Envelope["payload"];

// Thrown when the server answers a request with an `Error` frame.
export class WsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// One WebSocket to the api. Request/response by `id`; id 0 = server push.
//
//   const ws = await WsClient.connect(token);   // opens + authenticates
//   const reply = await ws.request({ case: "ping", value: create(PingSchema) });
export class WsClient {
  private nextId = 1n;
  private pending = new Map<bigint, { resolve: (p: Payload) => void; reject: (e: Error) => void }>();
  onPush: (payload: Payload) => void = () => {};
  onClose: (code: number) => void = () => {};

  private constructor(private ws: WebSocket) {
    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => this.receive(new Uint8Array(ev.data as ArrayBuffer));
    ws.onclose = (ev) => {
      for (const p of this.pending.values()) p.reject(new WsError("closed", "connection closed"));
      this.pending.clear();
      this.onClose(ev.code);
    };
  }

  // Open the socket, then send `authenticate` as the first frame.
  static async connect(accessToken: string, url = platform.wsUrl): Promise<{ ws: WsClient; user: User | undefined }> {
    const socket = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      socket.addEventListener("open", () => res(), { once: true });
      socket.addEventListener("error", () => rej(new WsError("connect_failed", "can't reach the server")), { once: true });
    });
    const ws = new WsClient(socket);
    const reply = await ws.request({ case: "authenticate", value: create(AuthenticateSchema, { accessToken }) });
    if (reply.case !== "authOk") throw new WsError("bad_reply", `expected authOk, got ${reply.case}`);
    return { ws, user: reply.value.user };
  }

  request(payload: Payload): Promise<Payload> {
    const id = this.nextId++;
    this.ws.send(toBinary(EnvelopeSchema, create(EnvelopeSchema, { id, payload })));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.ws.close();
  }

  private receive(bytes: Uint8Array) {
    const env = fromBinary(EnvelopeSchema, bytes);
    const waiting = this.pending.get(env.id);
    if (!waiting) return this.onPush(env.payload); // id 0 (or unknown) = push
    this.pending.delete(env.id);
    if (env.payload.case === "error") waiting.reject(new WsError(env.payload.value.code, env.payload.value.message));
    else waiting.resolve(env.payload);
  }
}
