import "@fontsource-variable/rubik";
import "@fontsource-variable/figtree";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

document.documentElement.classList.add("js");

// Only Windows gets the installer as the main button. Everyone else gets the web app first.
function isWindows(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  return /win/i.test(platform) || /Windows/i.test(navigator.userAgent);
}

if (!isWindows()) {
  for (const group of document.querySelectorAll<HTMLElement>("[data-actions]")) {
    const web = group.querySelector<HTMLElement>("[data-webapp]");
    const download = group.querySelector<HTMLElement>("[data-download]");
    if (!web || !download) continue;
    // Swap the visual weight, then the order.
    const webClass = web.className;
    web.className = download.className;
    download.className = webClass;
    group.prepend(web);
  }
  const note = document.querySelector("[data-platform-note]");
  if (note)
    note.textContent = "The desktop app is Windows only for now. The web app runs anywhere.";
}

// Fade sections up as they enter the viewport.
const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const el of reveals) io.observe(el);
} else {
  for (const el of reveals) el.classList.add("is-in");
}
