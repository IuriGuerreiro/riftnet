export const messageDomId = (id: bigint) => `msg-${id}`;

export function jumpTo(id: bigint) {
  const el = document.getElementById(messageDomId(id));
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-yellow-400");
  setTimeout(() => el.classList.remove("ring-2", "ring-yellow-400"), 1500);
  return true;
}
