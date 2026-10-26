import { startLanguage } from "./i18n";

// The language first, then the app: text worked out when a module loads is
// then already in the language on screen (see i18n/index.ts).
void startLanguage().finally(() => import("./boot"));
