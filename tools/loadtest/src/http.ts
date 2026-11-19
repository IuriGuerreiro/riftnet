import { check } from "k6";
import http from "k6/http";

import { API, identity, login, USERS } from "./lib.ts";

const POOL = Math.min(USERS, Number(__ENV.POOL ?? 50));

export const options = {
  setupTimeout: "5m",
  scenarios: {
    reads: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: Number(__ENV.RPS ?? 200), duration: __ENV.RAMP ?? "5m" },
        { target: Number(__ENV.RPS ?? 200), duration: __ENV.HOLD ?? "5m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    "http_req_duration{name:GET /me}": ["p(95)<150"],
    "http_req_duration{name:GET /friends}": ["p(95)<150"],
    "http_req_duration{name:GET /users/search}": ["p(95)<150"],
  },
};

export function setup() {
  return Array.from({ length: POOL }, (_, i) => login(i).accessToken);
}

export default function (tokens: string[]) {
  const headers = { Authorization: `Bearer ${tokens[Math.floor(Math.random() * tokens.length)]}` };
  const roll = Math.random();
  const res =
    roll < 0.5
      ? http.get(`${API}/me`, { headers, tags: { name: "GET /me" } })
      : roll < 0.8
        ? http.get(`${API}/friends`, { headers, tags: { name: "GET /friends" } })
        : http.get(
            `${API}/users/search?q=${identity(Math.floor(Math.random() * USERS)).username.slice(0, 7)}`,
            { headers, tags: { name: "GET /users/search" } },
          );
  check(res, { "status 200": (r) => r.status === 200 });
}
