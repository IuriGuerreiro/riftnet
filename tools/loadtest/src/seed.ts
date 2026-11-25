import { check } from "k6";
import exec from "k6/execution";

import { register, USERS } from "./lib.ts";

export const options = {
  scenarios: {
    seed: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS ?? 10),
      iterations: USERS,
      maxDuration: "30m",
    },
  },
};

export default function () {
  const status = register(exec.scenario.iterationInTest);
  check(status, { "registered or already exists": (s) => s === 200 || s === 409 });
}
