import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyLanguage } from "./text.ts";
import "./styles.css";

const root = document.getElementById("root");
// Main resolves the language for both processes; the window waits for it so it opens in it.
const start = async () => {
  // English stays if main can't answer, so the window still opens.
  await window.wave.settings.language().then(applyLanguage, () => undefined);
  if (root !== null)
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
};
void start();
