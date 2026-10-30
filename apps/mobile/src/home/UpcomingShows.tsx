import { showCardDate, type FollowShow, type FollowedArtist } from "@wave/core";
import { Linking, Text, View, useWindowDimensions } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { TitledSection } from "@/catalog/TitledSection";
import { openFollowedArtist } from "@/library/openFollowedArtist";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";
import { pressedRect } from "@/motion/pressedRect";
import { showMessage } from "@/overlay/alert";
import { MenuChoices, type MenuChoice } from "@/overlay/MenuChoices";
import { openOverlay } from "@/overlay/overlay";

import { useHomeFollow } from "./useHomeFollow";

/** A stub's width at the standard font size; it grows with the text. */
const STUB = CELL * 10;
/** The card at the standard font size: a stub and a body, the next card peeking in. */
const CARD = CELL * 34;
/** The notches cut where the stub tears off. */
const NOTCH = CELL * 2;
const PERFORATION_DOTS = 40;

/**
 * The tear line between stub and body: a notch cut from each edge and a
 * column of holes, all in the ground's tone, so the card reads as a ticket.
 */
function Perforation({ at }: { at: number }) {
  const notch = { width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, left: at - NOTCH / 2 };
  return (
    <>
      <View className="absolute bg-background" style={{ ...notch, top: -NOTCH / 2 }} />
      <View className="absolute bg-background" style={{ ...notch, bottom: -NOTCH / 2 }} />
      <View
        className="absolute overflow-hidden"
        style={{ left: at - 1, top: NOTCH, bottom: NOTCH, width: 2, gap: CELL / 2 }}
      >
        {Array.from({ length: PERFORATION_DOTS }, (_, index) => (
          <View key={index} className="bg-background" style={{ width: 2, height: 2 }} />
        ))}
      </View>
    </>
  );
}

/**
 * A show as a ticket: a flat field in the fill tone, the date on a stub torn
 * off at a perforation (the day large and light, the month as a catalog line
 * under it, never over it, then weekday and time), then the artist's circle,
 * name, city and venue. No
 * other card is a field, leads with a date or lies on its side, so a show
 * never reads as an album, a mix or a playlist. A tap opens the ticket page;
 * a long press offers Go to Artist and Open Tickets.
 */
function ShowCard({ show, artist }: { show: FollowShow; artist: FollowedArtist }) {
  const { language, strings } = useLocalisation();
  const copy = strings.upcomingShows;
  const { width, fontScale } = useWindowDimensions();
  const scale = Math.max(1, fontScale);
  const cardWidth = Math.min(CARD * scale, width - grid.margin * 2 - CELL * 3);
  const stubWidth = STUB * Math.min(scale, 1.5);
  const date = showCardDate(language, show.startsAt);
  const openTickets = () => {
    void Linking.openURL(show.ticketUrl).catch(() => showMessage(artist.name, copy.openFailed));
  };
  const goToArtist = () => {
    void openFollowedArtist(artist).catch(() => {});
  };
  const menu = () => {
    const entries: MenuChoice[] = [
      { action: "goToArtist", label: copy.goToArtist, onPress: goToArtist },
      { action: "openTickets", label: copy.openTickets, onPress: openTickets },
    ];
    openOverlay({
      label: artist.name,
      anchor: pressedRect(),
      render: (close) => (
        <MenuChoices
          cards={[]}
          entries={entries.map((entry) => ({
            ...entry,
            onPress: () => {
              close();
              entry.onPress();
            },
          }))}
        />
      ),
    });
  };
  return (
    <Press
      accessibilityRole="link"
      accessibilityLabel={`${artist.name}, ${date.spoken}, ${show.city}, ${show.venue}`}
      accessibilityHint={copy.opensTickets}
      onPress={openTickets}
      onLongPress={menu}
      haptic="selection"
      depth={0.02}
    >
      <View className="flex-1 flex-row overflow-hidden bg-fill" style={{ width: cardWidth }}>
        <View
          className="items-center"
          style={{
            width: stubWidth,
            paddingVertical: CELL * 2,
            paddingHorizontal: CELL,
            gap: CELL / 2,
          }}
        >
          <Text
            className="font-sans text-large-title font-light text-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
            adjustsFontSizeToFit
            numberOfLines={1}
          >
            {date.day}
          </Text>
          <CatalogLine>{date.month}</CatalogLine>
          <Text className="text-center font-sans text-footnote text-secondary">{date.weekday}</Text>
          {date.time !== null && (
            <Text
              className="text-center font-sans text-footnote font-medium text-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {date.time}
            </Text>
          )}
        </View>
        <View className="flex-1" style={{ padding: CELL * 2, gap: CELL }}>
          <ArtistImage
            artist={{ name: artist.name, thumbPath: null, artworkPath: null }}
            size={CELL * 5}
          />
          <View>
            <Text numberOfLines={2} className="font-sans text-body font-medium text-foreground">
              {artist.name}
            </Text>
            <Text numberOfLines={2} className="font-sans text-footnote text-foreground">
              {show.city}
            </Text>
            <Text numberOfLines={2} className="font-sans text-footnote text-secondary">
              {show.venue}
            </Text>
          </View>
        </View>
        <Perforation at={stubWidth} />
      </View>
    </Press>
  );
}

/** Home's Upcoming Shows: absent until a shows-level artist has a show coming in the country. */
export function UpcomingShows({ title }: { title: string }) {
  const { showCards: cards, follows } = useHomeFollow();
  if (cards.length === 0) return null;
  return (
    <TitledSection title={title}>
      <CoverRow>
        {cards.flatMap((show) => {
          const artist = follows.find((f) => f.key === show.artistKey);
          return artist === undefined
            ? []
            : [<ShowCard key={show.id} show={show} artist={artist} />];
        })}
      </CoverRow>
    </TitledSection>
  );
}
