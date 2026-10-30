import { homeFollowCards, type HomeFollowSnapshot } from "@wave/core";
import {
  createContext,
  createElement,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useScreenSight } from "@/lib/screenSight";
import { everyWhileInSight } from "@/lib/sight";
import { useFollowedArtistsEnabled } from "@/settings/followedArtists";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { currentFollowCountry, followCountry } from "@/settings/followCountry";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { appRuntime } from "@/library/runtime";
import { LibraryStore } from "@/library/LibraryStore";
import { followsSaved } from "@/library/followsSaved";
import { knownHomeFollow, readHomeFollowForVisit } from "./knownHomeFollow";
import { checkFollowReleases } from "./followReleases";

const empty: HomeFollowSnapshot = { follows: [], releases: [], shows: [], country: "" };
/** Each visible visit admits only cards already known when it began. */
const useHomeFollowState = (reading: boolean) => {
  const sight = useScreenSight();
  const enabled = useFollowedArtistsEnabled();
  const explicit = useDontPlayExplicit();
  const yt = useYtMusicEnabled();
  followCountry.useValue();
  const [now, setNow] = useState(() => Date.now());
  const [visit, setVisit] = useState(() => {
    const known = knownHomeFollow.get() ?? empty;
    return { admitted: known, latest: known };
  });
  const admitted = useRef(visit.admitted);
  const entering = useRef(false);
  const entered = useRef(false);
  const pendingRefresh = useRef(false);
  const refresh = useCallback(() => {
    if (entering.current) {
      pendingRefresh.current = true;
      return;
    }
    const opening = admitted.current;
    void readHomeFollowForVisit(opening)
      .then((latest) => {
        if (sight.visible() && admitted.current === opening)
          setVisit((current) => ({ ...current, latest }));
      })
      .catch(() => {});
  }, [sight]);
  useEffect(() => {
    if (!reading) return;
    let active = true;
    let controller: AbortController | undefined;
    let stopHistory = () => {};
    let entry = 0;
    const enter = (opening: boolean) => {
      const turn = ++entry;
      controller?.abort();
      if (!sight.visible()) return;
      entered.current = true;
      entering.current = true;
      setNow(Date.now());
      // Read saved follows/levels/country before admitting this visit or starting network checks.
      const previous = admitted.current;
      void readHomeFollowForVisit(opening ? undefined : previous)
        .then((known) => {
          if (!active || !sight.visible() || entry !== turn) return;
          if (opening) admitted.current = known;
          entering.current = false;
          setVisit({ admitted: opening ? known : previous, latest: known });
          if (pendingRefresh.current) {
            pendingRefresh.current = false;
            refresh();
          }
          controller = new AbortController();
          if (enabled)
            void appRuntime
              .runPromise(checkFollowReleases(yt, "home", false), { signal: controller.signal })
              .then((changed) => {
                if (changed && entry === turn) refresh();
              })
              .catch(() => {});
        })
        .catch(() => {
          if (entry === turn) entering.current = false;
        });
    };
    enter(!entered.current);
    const stopSight = sight.subscribe(() => enter(true));
    const stopSaved = followsSaved.subscribe(() => {
      if (sight.visible()) refresh();
    });
    void appRuntime
      .runPromise(LibraryStore)
      .then((store) => {
        if (active)
          stopHistory = store.listeningHistoryVersion.subscribe(() => {
            if (sight.visible()) refresh();
          });
      })
      .catch(() => {});
    const stopTimer = everyWhileInSight(sight, 60_000, () => {
      setNow(Date.now());
    });
    return () => {
      active = false;
      ++entry;
      entering.current = false;
      controller?.abort();
      stopHistory();
      stopSight();
      stopSaved();
      stopTimer();
    };
  }, [sight, enabled, yt, refresh, reading]);
  const cards = homeFollowCards(visit.latest, {
    now,
    enabled,
    blockExplicit: explicit,
    country: currentFollowCountry(),
    admitted: visit.admitted,
  });
  return { ...cards, follows: visit.latest.follows, refresh };
};

const HomeFollowPresence = createContext(false);
export const useHomeFollowPresence = () => useContext(HomeFollowPresence);
const HomeFollowContext = createContext<ReturnType<typeof useHomeFollowState> | null>(null);
export function HomeFollowProvider({
  children,
  reading = true,
}: {
  children: ReactNode;
  reading?: boolean;
}) {
  const value = useHomeFollowState(reading);
  return createElement(
    HomeFollowPresence.Provider,
    { value: true },
    createElement(HomeFollowContext.Provider, { value }, children),
  );
}
export const useHomeFollowContext = () => useContext(HomeFollowContext);
export const useHomeFollow = () => {
  const value = useHomeFollowContext();
  if (value === null) throw new Error("Home follow cards need their provider");
  return value;
};
