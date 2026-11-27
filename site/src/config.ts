const GITHUB_URL = "https://github.com/IuriGuerreiro/riftnet";

export const site = {
  SITE_URL: "https://riftnet.app",
  APP_URL: "https://app.riftnet.app",
  GITHUB_URL,
  // WARN: v0.1.0 only exists in adept-releases. Switch to GITHUB_URL once riftnet has a release.
  DOWNLOAD_URL:
    "https://github.com/IuriGuerreiro/adept-releases/releases/latest/download/adept-windows-x64-setup.exe",
} as const;
