/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN — leeg/ongezet = monitoring uit (no-op). */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
