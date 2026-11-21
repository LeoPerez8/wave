import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyLanguage } from "../text.ts";
import { MiniPlayer } from "./MiniPlayer.tsx";
import "../styles.css";
import "./miniPlayer.css";

const root = document.getElementById("root");
// As the main window does, the mini player waits for main's language so it opens in it.
const start = async () => {
  await window.wave.settings.language().then(applyLanguage, () => undefined);
  if (root !== null)
    createRoot(root).render(
      <StrictMode>
        <MiniPlayer />
      </StrictMode>,
    );
};
void start();
