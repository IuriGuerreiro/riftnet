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

// Loopi: the face follows the pointer, and a click makes him hop and wave.
const loopi = document.querySelector<SVGSVGElement>("[data-loopi]");
const look = loopi?.querySelector<SVGGElement>("[data-loopi-look]");
const motionOk = matchMedia("(prefers-reduced-motion: no-preference)").matches;

if (loopi && look && motionOk) {
  if (matchMedia("(pointer: fine)").matches) {
    let frame = 0;
    window.addEventListener("pointermove", (event) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = loopi.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height * 0.5);
        const reach = Math.min(1, Math.hypot(dx, dy) / 400);
        const angle = Math.atan2(dy, dx);
        // Values are in SVG units (the viewBox is 200 wide).
        look.style.transform = `translate(${(Math.cos(angle) * 5 * reach).toFixed(2)}px, ${(Math.sin(angle) * 3.5 * reach).toFixed(2)}px)`;
      });
    });
    document.addEventListener("pointerleave", () => {
      look.style.transform = "";
    });
  }

  const waveParts = loopi.querySelectorAll<SVGGElement>(".lp-wave-front, .lp-wave-back");
  loopi.addEventListener("pointerdown", () => {
    // Switching an animation off and on again (with a reflow between) restarts it.
    for (const el of [loopi, ...waveParts]) el.style.animation = "none";
    loopi.classList.remove("is-poked");
    void loopi.getBoundingClientRect();
    loopi.classList.add("is-poked");
    for (const el of [loopi, ...waveParts]) el.style.animation = "";
    for (const part of waveParts) part.style.animationDelay = "150ms";
  });
  loopi.addEventListener("animationend", (event) => {
    if (event.animationName === "lp-poke") loopi.classList.remove("is-poked");
  });
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
