import { ME, user } from "@/mock/data";

export function mentionsMe(text: string) {
  const handle = user(ME).handle.replaceAll(".", "\\.");
  return new RegExp(`(?<![\\w@.])@(?:${handle}|everyone|here)(?![\\w.])`, "i").test(text);
}
