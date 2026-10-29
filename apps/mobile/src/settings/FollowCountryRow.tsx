import { ScrollView } from "react-native";
import { ticketmasterKey } from "@/library/showNotifications";
import { SettingsPageRow } from "@/settings/SettingsPage";
import { ChoiceRow } from "@/settings/ChoiceRow";
import { openOverlay } from "@/overlay/overlay";
import { useLocalisation } from "@/localisation/localisation";
import { followCountry, currentFollowCountry, showCountries } from "./followCountry";
/** Settings › Followed Artists › Country: where shows are looked for. Absent without Ticketmaster's key. */
export function FollowCountryRow() {
  followCountry.useValue();
  const { language, strings } = useLocalisation();
  const countries = showCountries(language);
  const current = currentFollowCountry();
  const name = countries.find((c) => c.code === current)?.name ?? strings.shows.phoneRegion;
  if (ticketmasterKey === "") return null;
  return (
    <SettingsPageRow
      title={strings.shows.country}
      summary={name}
      onPress={() =>
        openOverlay({
          label: strings.shows.country,
          render: (close) => (
            <ScrollView style={{ maxHeight: 480 }}>
              <ChoiceRow
                label={strings.shows.phoneRegion}
                chosen={followCountry.get() === null}
                onPress={() => {
                  followCountry.set(null);
                  close();
                }}
              />
              {countries.map((c) => (
                <ChoiceRow
                  key={c.code}
                  label={c.name}
                  chosen={c.code === current}
                  onPress={() => {
                    followCountry.set(c.code);
                    close();
                  }}
                />
              ))}
            </ScrollView>
          ),
        })
      }
    />
  );
}
