import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { DEFAULT_THEME_CHOICE, readThemeChoice, themeFor } from "@wave/core";
import type { WaveBridge } from "../src/shared/bridge.ts";

/** The colour the window gives a theme token now. */
const token = (page: Page, name: string) =>
  page
    .locator(".desktop-shell")
    .evaluate((shell, key) => shell.style.getPropertyValue(`--color-${key}`), name);

const storedTheme = (page: Page) =>
  page.evaluate(
    async () => (await (window as unknown as { wave: WaveBridge }).wave.account.view()).theme,
  );

test("Appearance edits the theme: backgrounds, custom and saved colours, Reset, by keyboard", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-theme-editor-"));
  const app = await electron.launch({
    args: [join(import.meta.dirname, ".."), "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const shipped = themeFor(DEFAULT_THEME_CHOICE);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const appearance = page.getByRole("combobox", { name: "Appearance" });
    const row = (name: string) => page.getByRole("radiogroup", { name, exact: true });
    const reset = page.getByRole("button", { name: "Reset to defaults", exact: true });
    await expect(reset).toBeDisabled();

    // A background applies at once in the mode it belongs to, and stays out of the other.
    await appearance.selectOption("dark");
    await row("Dark background").getByRole("radio", { name: "Navy", exact: true }).click();
    await expect.poll(() => token(page, "background")).toBe("#0a0f1f");
    await expect(row("Dark background").getByRole("radio", { name: "Navy" })).toBeChecked();
    await appearance.selectOption("light");
    await expect.poll(() => token(page, "background")).toBe(shipped.light.background);
    await row("Light background").getByRole("radio", { name: "Sand", exact: true }).click();
    await expect.poll(() => token(page, "background")).toBe("#ede6da");
    await page.screenshot({ path: test.info().outputPath("theme-editor-light.png") });
    await appearance.selectOption("dark");
    await expect.poll(() => token(page, "background")).toBe("#0a0f1f");

    // Every swatch has a name.
    const names = await page
      .locator(".theme-settings [role=radio]")
      .evaluateAll((swatches) => swatches.map((swatch) => swatch.getAttribute("aria-label")));
    expect(names.length).toBe(16);
    expect(names.every((name) => name !== null && name.length > 0)).toBe(true);

    // Primary by keyboard alone: the arrows reach the custom swatch, Enter opens the picker.
    const primary = row("Primary");
    await primary.getByRole("radio", { name: "Default", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(primary.getByRole("radio", { name: "Custom colour" })).toBeFocused();
    await page.keyboard.press("Enter");
    const picker = page.getByRole("group", { name: "Primary colour", exact: true });
    await expect(picker.getByLabel("Custom colour")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(picker.getByRole("textbox", { name: "Hex colour" })).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("7aaef5");
    await page.keyboard.press("Tab");
    await expect(picker.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    // Saved, not applied.
    const saved = primary.getByRole("radio", { name: "Saved colour 1, #7aaef5", exact: true });
    await expect(saved).toBeVisible();
    await expect(saved).not.toBeChecked();
    await expect(picker.getByRole("status")).toHaveText("This colour is saved.");
    await expect(picker.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    // Another colour, typed and applied with Enter: the picker closes on the custom swatch.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("zz");
    await expect(picker.getByRole("status")).toHaveText("Enter a 3- or 6-digit hex colour.");
    await expect(picker.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("e8c454");
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();
    await expect.poll(() => token(page, "accent")).toBe("#e8c454");
    const custom = primary.getByRole("radio", { name: "Custom colour" });
    await expect(custom).toBeFocused();
    await expect(custom).toBeChecked();
    // Escape closes the picker without a change.
    await page.keyboard.press("Enter");
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(custom).toBeFocused();
    // The saved colour applies, then is removed with its button; the colour in use stays.
    await page.keyboard.press("ArrowLeft");
    await expect(saved).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(() => token(page, "accent")).toBe("#7aaef5");
    await expect(saved).toBeChecked();
    await page.screenshot({ path: test.info().outputPath("theme-editor-dark.png") });
    await page.keyboard.press("Tab");
    const remove = primary.getByRole("button", {
      name: "Remove Saved colour 1, #7aaef5",
      exact: true,
    });
    await expect(remove).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(saved).toHaveCount(0);
    expect(await token(page, "accent")).toBe("#7aaef5");

    // Secondary from the colour well, with Done.
    const secondary = row("Secondary");
    await secondary.getByRole("radio", { name: "Custom colour" }).click();
    const second = page.getByRole("group", { name: "Secondary colour", exact: true });
    await second.getByLabel("Custom colour").fill("#f5917e");
    await expect(second.getByRole("textbox", { name: "Hex colour" })).toHaveValue("f5917e");
    await page.screenshot({ path: test.info().outputPath("theme-editor-picker.png") });
    await second.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(() => token(page, "highlight")).toBe("#f5917e");

    // The theme is the synced one: what the account holds is what the window shows.
    const kept = themeFor(readThemeChoice(await storedTheme(page)));
    expect(kept.dark.background).toBe("#0a0f1f");
    expect(kept.light.background).toBe("#ede6da");
    expect(kept.dark.highlight).toBe("#f5917e");

    // Reset to Defaults.
    await reset.click();
    await expect.poll(() => token(page, "background")).toBe(shipped.dark.background);
    expect(await token(page, "accent")).toBe(shipped.dark.accent);
    expect(await token(page, "highlight")).toBe(shipped.dark.highlight);
    await expect(reset).toBeDisabled();
    await appearance.selectOption("light");
    await expect.poll(() => token(page, "background")).toBe(shipped.light.background);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
