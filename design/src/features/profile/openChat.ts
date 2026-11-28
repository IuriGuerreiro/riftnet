let handler: (id: string) => void = () => {};

export function onOpenChat(fn: (id: string) => void) {
  handler = fn;
}

export const openChat = (id: string) => handler(id);
