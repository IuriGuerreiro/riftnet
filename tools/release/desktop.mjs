import { readFileSync, statSync, writeFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../../client/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const { version } = config;
const { GITHUB_REPOSITORY: repo, TAURI_UPDATER_PUBLIC_KEY: pubkey, RELEASE_NOTES } = process.env;
const assetNames = {
  "windows-x86_64": "adept-windows-x64-setup.exe",
};

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error("The Tauri version must be a stable major.minor.patch version.");
}
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) {
  throw new Error("Set GITHUB_REPOSITORY to the release repository (owner/name).");
}

const releases = `https://github.com/${repo}/releases`;
const command = process.argv[2];

if (command === "config") {
  if (!pubkey?.trim()) throw new Error("Set TAURI_UPDATER_PUBLIC_KEY to the updater public key.");
  writeFileSync(
    process.argv[3],
    JSON.stringify({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          pubkey: pubkey.trim(),
          requireSignedVersion: true,
          endpoints: [`${releases}/latest/download/latest.json`],
        },
      },
    }),
  );
} else if (command === "manifest") {
  const platforms = Object.fromEntries(
    Object.entries(assetNames).map(([platform, asset]) => {
      if (!statSync(asset).size) throw new Error(`Empty bundle: ${asset}`);
      const signature = readFileSync(`${asset}.sig`, "utf8").trim();
      const [header, , trustedComment] = Buffer.from(signature, "base64").toString().split("\n");
      if (
        !header.startsWith("untrusted comment:") ||
        !trustedComment?.split("\t").includes(`version:${version}`)
      ) {
        throw new Error(`Expected a signature for version ${version}: ${asset}.sig`);
      }
      return [platform, { signature, url: `${releases}/download/v${version}/${asset}` }];
    }),
  );
  writeFileSync(
    "latest.json",
    JSON.stringify({ version, notes: RELEASE_NOTES || undefined, platforms }, null, 2) + "\n",
  );
} else {
  throw new Error("Expected config or manifest.");
}
