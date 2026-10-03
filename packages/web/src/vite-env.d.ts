/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electronAPI?: {
    isElectron: true;
    /** The API's origin (the desktop build's, e.g. https://app.example.com). */
    apiOrigin?: string;
    sync: {
      setToken: (token: string) => Promise<void>;
      clearToken?: () => Promise<void>;
    };
  };
}
