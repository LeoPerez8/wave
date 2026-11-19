import type { LanguageChoice } from "@wave/core";
import type { LanguageView } from "../../shared/language.ts";
import { applyLanguage, labels } from "./text.ts";
import "./languageSettings.css";

/**
 * Settings › Appearance's Language: System, English or Português (Brasil), the account-wide
 * choice main keeps and syncs. The window switches as soon as main has saved it.
 */
export function LanguageSettings({
  view,
  onError,
}: {
  readonly view: LanguageView;
  readonly onError: () => void;
}) {
  return (
    <div className="language-settings">
      <h2>{labels.language}</h2>
      <select
        aria-label={labels.language}
        value={view.choice}
        onChange={(event) => {
          const choice = event.target.value as LanguageChoice;
          void window.wave.settings
            .setLanguage(choice)
            .then(() => window.wave.settings.language())
            .then(applyLanguage)
            .catch(onError);
        }}
      >
        {(["system", "en", "pt-BR"] as const).map((key) => (
          <option key={key} value={key}>
            {labels.languages[key]}
          </option>
        ))}
      </select>
    </div>
  );
}
