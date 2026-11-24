import { expect, test } from "vitest";

import { padState } from "./padState";

test.each([
  [undefined, "unsupported"],
  [{ supported: false, driver: true }, "unsupported"],
  [{ supported: true, driver: false }, "missing"],
  [{ supported: true, driver: true }, "ready"],
])("%j is %s", (status, expected) => {
  expect(padState(status)).toBe(expected);
});
