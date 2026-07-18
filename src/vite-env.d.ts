/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN — leeg/ongezet = monitoring uit (no-op). */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-info geïnjecteerd via Vite `define` (zie vite.config.ts). */
declare const __BUILD_INFO__: {
  readonly version: string;
  readonly sha: string;
  readonly builtAt: string;
};
