import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { WaveSoulseek, soulseekErrorCode, type SoulseekSession } from "@/native/waveSoulseek";

import { setBestQuality } from "./bestQuality";

const sessionCall = <A,>(call: () => Promise<A>) =>
  Effect.runPromise(Effect.tryPromise({ try: call, catch: (cause) => cause }));

/** Why turning it on didn't work; the switch goes back off. */
const turnOnMessage = (error: unknown): string => {
  switch (soulseekErrorCode(error)) {
    case "ERR_SLSK_UNREACHABLE":
      return "Soulseek's server isn't answering. Try again later.";
    case "ERR_SLSK_NO_ACCOUNT":
      return "Couldn't make a Soulseek account. Try again.";
    default:
      return "Couldn't connect to Soulseek. Try again when you're online.";
  }
};

/**
 * Settings › Downloads: Download in best quality. On, downloads come from Soulseek as MP3 320 kbps,
 * with an account the native module makes (or the phone's own); off, from YouTube Music while YT
 * Music is on. The account never reaches JS beyond the session's status.
 */
export function DownloadsSettingsSection() {
  const [session, setSession] = useState<SoulseekSession>({ status: "off", username: null });
  /** The value asked for while the native module turns it on or off. */
  const [asked, setAsked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const subscription = WaveSoulseek.addListener("onSessionChanged", (next) => {
      if (current) setSession(next);
    });
    void sessionCall(() => WaveSoulseek.session())
      .then(
        (next) => {
          if (current) setSession(next);
        },
        () => {
          if (current) setMessage("Couldn't read the setting. Reopen Settings to retry.");
        },
      )
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  const change = (on: boolean): void => {
    if (busy) return;
    setBusy(true);
    setAsked(on);
    setMessage(null);
    void sessionCall(() => (on ? WaveSoulseek.turnOn() : WaveSoulseek.turnOff()))
      .then(
        (next) => {
          setSession(next);
          // The switch syncs as a preference once it has moved here.
          setBestQuality(on);
        },
        (error: unknown) =>
          setMessage(on ? turnOnMessage(error) : "Couldn't turn it off. Try again."),
      )
      .finally(() => {
        setBusy(false);
        setAsked(null);
      });
  };

  return (
    <View>
      <Hairline />
      <SettingsSwitch
        label="Download in best quality"
        value={asked ?? session.status !== "off"}
        disabled={busy}
        onValueChange={change}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Best quality is MP3 320 kbps from other people's shared music. It's slower than YouTube
        Music, and a song it can't find comes from YouTube Music instead. Off, downloads come from
        YouTube Music while YT Music is on.
      </Text>
      {message !== null && (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 font-sans text-footnote text-secondary"
        >
          {message}
        </Text>
      )}
    </View>
  );
}
