import { ytSignInFollowsWave, type WaveSession } from "@wave/core";

import { WaveYtMusic } from "@/native/waveYtMusic";
import { signInToYtMusic } from "@/settings/ytAccount";
import { ytMusicEnabled } from "@/settings/ytMusic";

/**
 * After a Wave account sign-in from the invitation or Settings: opens YT Music's sign-in, as
 * Settings' Sign In does, when Core's `ytSignInFollowsWave` says so (YT Music on and signed
 * out). Its page gets the Wave account's email from the saved session; backing out of it says
 * nothing and keeps the Wave account. Never rejects.
 */
export const ytSignInAfterWave = async (wave: WaveSession): Promise<void> => {
  const yt = await WaveYtMusic.session().catch(() => null);
  if (yt !== null && ytSignInFollowsWave(wave, ytMusicEnabled(), yt)) await signInToYtMusic();
};
