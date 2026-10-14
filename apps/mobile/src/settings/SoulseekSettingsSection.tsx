import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { WaveSoulseek, soulseekErrorCode, type SoulseekSession } from "@/native/waveSoulseek";
import { useThemeColor } from "@/theme/useThemeColor";

const sessionCall = <A,>(call: () => Promise<A>) =>
  Effect.runPromise(Effect.tryPromise({ try: call, catch: (cause) => cause }));

/**
 * The Soulseek account downloads use first; without one, or when Soulseek can't deliver a song,
 * they come from YouTube Music while YT Music is on. Credentials remain in native no-backup
 * storage after connection.
 */
export function SoulseekSettingsSection() {
  const [session, setSession] = useState<SoulseekSession>({ status: "signedOut", username: null });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");

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
          if (current) setMessage("Couldn't read the Soulseek account. Reopen Settings to retry.");
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

  const connect = (): void => {
    if (busy || username.trim() === "" || password === "") return;
    setBusy(true);
    setMessage(null);
    const request = sessionCall(() => WaveSoulseek.connect(username.trim(), password));
    setPassword("");
    void request
      .then(setSession, (error: unknown) => {
        const code = soulseekErrorCode(error);
        setMessage(
          code === "ERR_SLSK_AUTH"
            ? "This username is already in use, or the password is incorrect."
            : code === "ERR_SLSK_UNREACHABLE"
              ? "Soulseek's server isn't answering. Try again later."
              : "Couldn't connect to Soulseek. Try again when you're online.",
        );
      })
      .finally(() => setBusy(false));
  };
  const disconnect = (): void => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setPassword("");
    void sessionCall(() => WaveSoulseek.disconnect())
      .then(setSession, () => setMessage("Couldn't disconnect. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <CatalogLine className="mb-2 mt-12">Downloads</CatalogLine>
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        With a Soulseek account, Wave finds the same recording on Soulseek and saves MP3 320 kbps to
        your Library. When Soulseek can't deliver a song, and without an account, downloads come
        from YouTube Music while YT Music is on. Connect with your Soulseek account, or choose an
        unused username and a password to create a free account.
      </Text>
      {session.status === "signedOut" ? (
        <View className="mt-4">
          <TextInput
            accessibilityLabel="Soulseek username"
            placeholder="Soulseek username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            editable={!busy}
            placeholderTextColor={secondary}
            selectionColor={accent}
            cursorColor={accent}
            className="font-sans text-body text-foreground"
            style={{ height: grid.row, padding: 0 }}
          />
          <Hairline />
          <TextInput
            accessibilityLabel="Soulseek password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            placeholderTextColor={secondary}
            selectionColor={accent}
            cursorColor={accent}
            returnKeyType="done"
            onSubmitEditing={connect}
            className="font-sans text-body text-foreground"
            style={{ height: grid.row, padding: 0 }}
          />
          <Hairline />
          <View className="mt-4 items-start">
            <TextButton
              label={busy ? "Connecting…" : "Connect"}
              disabled={busy || username.trim() === "" || password === ""}
              onPress={connect}
            />
          </View>
        </View>
      ) : (
        <View className="mt-4">
          <Text className="font-sans text-body text-foreground">Account: {session.username}</Text>
          <View className="mt-4 items-start">
            <TextButton
              label={busy ? "Disconnecting…" : "Disconnect"}
              disabled={busy}
              onPress={disconnect}
            />
          </View>
          <Text className="font-sans text-footnote text-secondary">
            Wave reconnects for downloads. Disconnect forgets this account on the phone.
          </Text>
        </View>
      )}
      {message !== null && (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 font-sans text-footnote text-secondary"
        >
          {message}
        </Text>
      )}
    </>
  );
}
