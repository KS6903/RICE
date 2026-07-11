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
    sync: {
      setToken: (token: string) => Promise<void>;
      clearToken?: () => Promise<void>;
    };
  };
}
