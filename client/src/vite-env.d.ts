/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_UPDATES?: string;
  readonly VITE_WEB_URL?: string;
  readonly VITE_API_HTTP?: string;
  readonly VITE_API_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
