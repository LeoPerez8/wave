import type { LibraryCounts } from "@wave/client/db/counts";
import { catalogueOf, resolveAppLanguage } from "@wave/core";
import { useEffect, useState } from "react";

const text = catalogueOf(resolveAppLanguage(navigator.languages), "desktop");

export function App() {
  const [counts, setCounts] = useState<LibraryCounts>();
  useEffect(() => {
    let current = true;
    void window.wave.library.counts().then((next) => {
      if (current) setCounts(next);
    });
    return () => {
      current = false;
    };
  }, []);
  return (
    <main className="flex min-h-screen flex-col gap-1 bg-background p-8 font-sans text-foreground">
      <h1 className="text-3xl font-light">{text.tabs.library}</h1>
      {counts !== undefined && (
        <p className="text-secondary" data-testid="song-count">
          {text.library.songCount(counts.songs)}
        </p>
      )}
    </main>
  );
}
