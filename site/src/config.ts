// Every public URL the site links to. Change them here only.
const GITHUB_URL = "https://github.com/IuriGuerreiro/riftnet";

export const site = {
  SITE_URL: "https://riftnet.app",
  APP_URL: "https://app.riftnet.app",
  GITHUB_URL,
  // The only release so far (v0.1.0) is in the old adept-releases repo. Once a
  // release is published in this repo, switch to `${GITHUB_URL}/releases/latest/download/...`.
  DOWNLOAD_URL:
    "https://github.com/IuriGuerreiro/adept-releases/releases/latest/download/adept-windows-x64-setup.exe",
} as const;
