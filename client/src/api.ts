import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EnvelopeSchema, type Envelope } from "./gen/v1/envelope_pb";
import { platform } from "./platform";

// Minimal request/response client over the WebSocket: id in, same id out.
export class ApiClient {
  private ws: WebSocket;
  private nextId = 1n;
  private pending = new Map<bigint, (env: Envelope) => void>();
  onPush: (env: Envelope) => void = () => {};

  constructor(url = platform.apiUrl) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (ev) => {
      const env = fromBinary(EnvelopeSchema, new Uint8Array(ev.data as ArrayBuffer));
      const resolve = this.pending.get(env.id);
      if (resolve) {
        this.pending.delete(env.id);
        resolve(env);
      } else {
        this.onPush(env);
      }
    };
  }

  ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((res, rej) => {
      this.ws.addEventListener("open", () => res(), { once: true });
      this.ws.addEventListener("error", () => rej(new Error("connection failed")), { once: true });
    });
  }

  request(payload: Envelope["payload"]): Promise<Envelope> {
    const id = this.nextId++;
    const env = create(EnvelopeSchema, { id, payload });
    this.ws.send(toBinary(EnvelopeSchema, env));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
}
