/**
 * Home's New from Artists You Follow and Upcoming Shows. Main picks the cards with the phone's
 * rules (`home.follow`); a section with no card isn't drawn.
 */
import { homeSectionTitle, releaseDateLine, showCardDate } from "@wave/core";
import { useEffect, useState } from "react";
import type { BrowseScope } from "../../shared/browse.ts";
import type { HomeFollowView, HomeReleaseCard, HomeShowCard } from "../../shared/homeFollow.ts";
import { Icon } from "./Icon.tsx";
import { language, text } from "./text.ts";
import type { YtRoute } from "./YtPages.tsx";
import "./homeFollow.css";

const NONE: HomeFollowView = { releases: [], shows: [] };

/**
 * One check per window, shared by every visit to Home: a visit made while it runs still hears
 * what it saved, and a check that failed is asked again on the next visit.
 */
let check: Promise<boolean> | undefined;

/** Both sections' cards, read again when the Library changes or a check saved something. */
export function useHomeFollow(revision: number): HomeFollowView {
  const [view, setView] = useState(NONE);
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    let current = true;
    void window.wave.home
      .follow()
      .then((next) => {
        if (current) setView(next);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [revision, saved]);
  useEffect(() => {
    let current = true;
    const asked = (check ??= window.wave.home.followCheck());
    void asked.then(
      (changed) => {
        if (changed && current) setSaved((value) => value + 1);
      },
      () => {
        if (check === asked) check = undefined;
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return view;
}

const covers = new Map<string, Promise<string | null>>();

function ReleaseCover({ card }: { readonly card: HomeReleaseCard }) {
  const [loaded, setLoaded] = useState<{ key: string; image: string | null }>();
  useEffect(() => {
    if (!card.hasArtwork) return;
    let current = true;
    let read = covers.get(card.key);
    if (!read) {
      read = window.wave.home.releaseArtwork(card.key).catch(() => null);
      covers.set(card.key, read);
      void read.then((image) => {
        if (image === null) covers.delete(card.key);
      });
    }
    void read.then((image) => {
      if (current) setLoaded({ key: card.key, image });
    });
    return () => {
      current = false;
    };
  }, [card.key, card.hasArtwork]);
  const image = loaded?.key === card.key ? loaded.image : null;
  return (
    <span className="artwork">{image ? <img src={image} alt="" /> : <Icon name="albums" />}</span>
  );
}

export function HomeNewReleases({
  cards,
  go,
  notify,
}: {
  readonly cards: readonly HomeReleaseCard[];
  readonly go: (to: BrowseScope | YtRoute) => void;
  readonly notify: (message: string) => void;
}) {
  const [opening, setOpening] = useState<string>();
  // The day the release lines count from: the one Home was opened on.
  const [now] = useState(() => Date.now());
  if (cards.length === 0) return null;
  const title = homeSectionTitle("new-releases", text);
  const open = (card: HomeReleaseCard) => {
    if (opening !== undefined) return;
    setOpening(card.key);
    void window.wave.home
      .openRelease(card.key)
      .then((opened) => {
        if (opened.kind === "album") go({ kind: "album", id: opened.id });
        else if (opened.kind === "ytAlbum") go({ kind: "ytAlbum", id: opened.browseId });
        else
          notify(
            opened.kind === "ytMusicOff"
              ? text.newReleases.ytMusicOff
              : opened.kind === "noAnswer"
                ? text.newReleases.noAnswer
                : text.newReleases.unavailable,
          );
      })
      .catch(() => notify(text.newReleases.noAnswer))
      .finally(() => setOpening(undefined));
  };
  return (
    <section className="shelf" aria-label={title} data-section="new-releases">
      <h2>{title}</h2>
      <div className="shelf-row" role="list">
        {cards.map((card) => {
          const type = text.newReleases[card.type];
          const date = releaseDateLine(card.releaseDate, now, text);
          return (
            <div key={card.key} role="listitem">
              <button
                className="tile release-tile"
                aria-label={[card.title, card.artist, type, date].filter(Boolean).join(", ")}
                aria-busy={opening === card.key}
                title={card.title}
                onClick={() => open(card)}
              >
                <ReleaseCover card={card} />
                <span className="release-type" aria-hidden="true">
                  {type}
                </span>
                <span className="tile-title truncate">{card.title}</span>
                <span className="tile-caption truncate secondary">{card.artist}</span>
                <span className="tile-caption truncate secondary">{date}</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ticketLink = (url: string) => /^https?:\/\//i.test(url);

function ShowCard({ card }: { readonly card: HomeShowCard }) {
  const date = showCardDate(language, card.startsAt);
  const place = [card.city, card.venue].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="show-date" aria-hidden="true">
        <span className="show-month">{date.month}</span>
        <span className="show-day">{date.day}</span>
        <span className="show-weekday secondary">
          {[date.weekday, date.time].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="show-facts" aria-hidden="true">
        <span className="show-artist truncate">{card.artist}</span>
        <span className="show-place truncate secondary">{place}</span>
      </span>
    </>
  );
  const label = [card.artist, date.spoken, place].filter(Boolean).join(", ");
  return ticketLink(card.ticketUrl) ? (
    <a
      className="show-card"
      href={card.ticketUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label}. ${text.upcomingShows.opensTickets}`}
      title={text.upcomingShows.openTickets}
    >
      {body}
    </a>
  ) : (
    <div className="show-card" aria-label={label}>
      {body}
    </div>
  );
}

export function HomeUpcomingShows({ cards }: { readonly cards: readonly HomeShowCard[] }) {
  if (cards.length === 0) return null;
  const title = homeSectionTitle("upcoming-shows", text);
  return (
    <section className="shelf" aria-label={title} data-section="upcoming-shows">
      <h2>{title}</h2>
      <div className="shelf-row" role="list">
        {cards.map((card) => (
          <div key={card.id} role="listitem">
            <ShowCard card={card} />
          </div>
        ))}
      </div>
    </section>
  );
}
