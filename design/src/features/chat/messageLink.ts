export function messageLink(conversation: string, message: string) {
  const url = new URL(window.location.href);
  url.pathname = "/app";
  url.hash = new URLSearchParams({ conversation, message }).toString();
  return url.href;
}

export function readMessageLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const conversation = params.get("conversation");
  const message = params.get("message");
  return conversation && message ? { conversation, message } : null;
}
