import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Skip voice notes and recordings (Settings › Library), on unless the owner
 * turned it off: scans leave WhatsApp voice notes and phone recordings out of
 * the Library (Core's `isVoiceNoteOrRecording`). Each phone's own, as its
 * music folders are: never synced. Settings changes it through the library
 * runtime's `setSkipVoiceNotes`, which rescans.
 */
const skipVoiceNotesSetting = persistedSetting<boolean>({
  key: "settings.skipVoiceNotes",
  read: (stored) => stored !== "off",
  write: (on) => (on ? null : "off"),
});

/** Whether scans leave voice notes and recordings out. */
export const skipVoiceNotes = skipVoiceNotesSetting.get;

/** Saves the switch alone; Settings goes through the runtime's `setSkipVoiceNotes`, which rescans. */
export const storeSkipVoiceNotes = skipVoiceNotesSetting.set;

/** Whether Skip voice notes and recordings is on; re-renders when it changes. */
export const useSkipVoiceNotes = skipVoiceNotesSetting.useValue;
