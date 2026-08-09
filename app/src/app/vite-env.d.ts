/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SINGLE_ROUTE_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
