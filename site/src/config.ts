// Every public URL the site links to. Change them here only.
const GITHUB_URL = "https://github.com/IuriGuerreiro/riftnet";

export const site = {
  SITE_URL: "https://riftnet.app",
  APP_URL: "https://app.riftnet.app",
  GITHUB_URL,
  // Installers are published to a separate public repo (vars.DESKTOP_RELEASE_REPO).
  DOWNLOAD_URL:
    "https://github.com/IuriGuerreiro/adept-releases/releases/latest/download/adept-windows-x64-setup.exe",
} as const;
