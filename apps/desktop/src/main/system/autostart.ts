import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LoginRegistration {
  readonly openAtLogin: boolean;
  readonly path: string;
  readonly args: string[];
}

/** Desktop Entry Exec quoting, followed by the entry's string-value escaping. */
const execArgument = (value: string): string => {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid login executable");
  return `"${value
    .replace(/[\\"$`]/g, "\\$&")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "%%")}"`;
};

/** Windows' login item API and Linux's per-user XDG autostart entry. */
export const configureAutostart = async (
  options: {
    readonly platform: string;
    readonly config: string;
    readonly executable: string;
    readonly args: readonly string[];
    readonly setLogin?: (settings: LoginRegistration) => void;
  },
  on: boolean,
): Promise<void> => {
  const args = [...options.args, "--hidden"];
  if (options.platform === "win32") {
    if (!options.setLogin) throw new Error("Login registration unavailable");
    options.setLogin({ openAtLogin: on, path: options.executable, args });
    return;
  }
  if (options.platform !== "linux") throw new Error("Unsupported login platform");
  const folder = join(options.config, "autostart");
  const file = join(folder, "wave.desktop");
  if (!on) {
    await rm(file, { force: true });
    return;
  }
  const command = [options.executable, ...args].map(execArgument).join(" ");
  await mkdir(folder, { recursive: true });
  // not UI text: Desktop Entry keys and the Wave brand, consumed by the login manager.
  const entry = `[Desktop Entry]\nType=Application\nName=Wave\nExec=${command}\nTerminal=false\n`;
  await writeFile(`${file}.tmp`, entry, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
};
