import type { SearchOnline } from "@wave/core";
import { text } from "./text.ts";

/**
 * Search online, kept on this computer. The phone's "Always on Wi-Fi" isn't offered: the desktop
 * shows no Wi-Fi or mobile-data choices.
 */
export function SearchOnlineSetting({
  value,
  onChange,
}: {
  readonly value: SearchOnline;
  readonly onChange: (value: SearchOnline) => void;
}) {
  return (
    <label className="search-online-setting">
      <span>{text.settings.searchOnline}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as SearchOnline)}>
        <option value="onDemand">{text.settings.onlyOnDemand}</option>
        <option value="always">{text.settings.alwaysSearchOnline}</option>
      </select>
    </label>
  );
}
