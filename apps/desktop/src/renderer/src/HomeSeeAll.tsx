import { homeSectionTitle } from "@wave/core";
import { useEffect, useMemo, useState } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { Page } from "../../shared/bridge.ts";
import type { HomeRow, HomeSeeAllSection } from "../../shared/home.ts";
import { time, VirtualTable } from "./VirtualTable.tsx";
import { labels, text } from "./text.ts";

/** Recently Added's or Recently Played's See all: every album the shelf holds, as a table. */
export interface HomeSeeAllRoute {
  readonly kind: "homeSeeAll";
  readonly section: HomeSeeAllSection;
}

const ALBUMS: BrowseScope = { kind: "albums" };

export function HomeSeeAll({
  route,
  revision,
  go,
  onError,
}: {
  readonly route: HomeSeeAllRoute;
  readonly revision: number;
  readonly go: (scope: BrowseScope) => void;
  readonly onError: () => void;
}) {
  const [page, setPage] = useState<Page<HomeRow>>();
  useEffect(() => {
    let current = true;
    void window.wave.home
      .seeAll(route.section)
      .then((rows) => {
        if (current) setPage(rows);
      })
      .catch(() => {
        if (current) onError();
      });
    return () => {
      current = false;
    };
  }, [route.section, revision, onError]);
  // The current language's text, so the label follows a change of language.
  const strings = text;
  const preview = useMemo(
    () =>
      page && {
        id: `home-see-all-${route.section}`,
        label: homeSectionTitle(route.section, strings),
        page,
        trailing: (row: BrowseRow) => time(row.durationMs),
        trailingHeading: labels.time,
      },
    [page, route.section, strings],
  );
  if (preview === undefined)
    return (
      <p className="secondary" role="status">
        {labels.loading}
      </p>
    );
  return (
    <VirtualTable
      scope={ALBUMS}
      revision={0}
      preview={preview}
      onOpen={(row) => go({ kind: "album", id: row.id })}
      onError={onError}
    />
  );
}
