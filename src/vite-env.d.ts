/// <reference types="vite/client" />

/** Build-info geïnjecteerd via Vite `define` (zie vite.config.ts). */
declare const __BUILD_INFO__: {
  readonly version: string;
  readonly sha: string;
  readonly builtAt: string;
};
