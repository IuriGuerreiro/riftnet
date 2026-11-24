import { expect, test } from "vitest";

import { padState } from "./padState";

test.each([
  [undefined, "unsupported"],
  [{ supported: false, driver: true, helper: true }, "unsupported"],
  [{ supported: true, driver: false, helper: false }, "missing"],
  [{ supported: true, driver: true, helper: false }, "missing"],
  [{ supported: true, driver: false, helper: true }, "missing"],
  [{ supported: true, driver: true, helper: true }, "ready"],
])("%j is %s", (status, expected) => {
  expect(padState(status)).toBe(expected);
});
