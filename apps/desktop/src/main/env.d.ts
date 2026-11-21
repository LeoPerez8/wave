/** What electron-vite puts in main's bundle from the build's environment (`MAIN_VITE_*`). */
interface ImportMetaEnv {
  readonly MAIN_VITE_WAVE_SYNC_URL?: string;
  readonly MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID?: string;
  readonly MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_SECRET?: string;
  readonly MAIN_VITE_WAVE_SPOTIFY_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
