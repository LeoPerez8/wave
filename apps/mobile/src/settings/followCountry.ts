import { persistedSetting } from "@/lib/persistedSetting";
import { useLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";
/** The owner's country for shows, a code such as "BR"; null follows the phone's region. Never synced. */
export const followCountry = persistedSetting<string | null>({
  key: "settings.followCountry",
  read: (s) => s,
  write: (s) => s,
});
const countries = new Map<string, { code: string; name: string }[]>();
export const showCountries = (language: string) => {
  let result = countries.get(language);
  if (!result) {
    result = WaveNative.showCountries?.(language) ?? [];
    countries.set(language, result);
  }
  return result;
};
export const currentFollowCountry = () => followCountry.get() ?? WaveNative.phoneCountry?.() ?? "";
/** The country shows are looked for in, named in the app's language (its code when unnamed). */
export const useFollowCountryName = (): string => {
  followCountry.useValue();
  const { language } = useLocalisation();
  const code = currentFollowCountry();
  return showCountries(language).find((c) => c.code === code)?.name ?? code;
};
