import { TAB_PATH } from "@wave/core";
import { Redirect } from "expo-router";

/**
 * Where the retired Discover screen was. Discover is Home's mixes now, so an
 * old link lands on Home rather than on a missing screen, and nothing asks
 * YouTube Music for the account's recommendations.
 */
export default function DiscoverRedirect() {
  return <Redirect href={TAB_PATH.index} />;
}
