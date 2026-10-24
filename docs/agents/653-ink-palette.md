# Ink palette handoff (#654)

Core exports `INK_PALETTE` (24 inks, each with `id`, `kind`, `light`, `dark`),
`INK_PAIRS` (576 ordered pairs), and `inkPairFor(choice)`. Custom colours match
their corrected dark ink across both groups. Below OKLCH chroma 0.12 they can
only match presets. Teal and Ember keep the shipped icon inks; preset pair ids
are unchanged.

For #655, `LAUNCHER_ICONS` already consumes all 576 pairs without changing its
object shape, and `launcherIconFor` uses the palette matcher. Its first entry
stays `teal_ember`, which the existing plugin enables by default. Check the
native alias validation/switching against the full catalog. No Android plugin
or native code changed in #654.

For #656, `paletteSplashThemeFor(choice, pair?)` returns the palette style's
`name`, matched `choice`, and readable `light`/`dark` colours, or null for the
manifest's default splash. For generation, enumerate both background groups
and `INK_PAIRS`, passing each pair explicitly. That gives 20,735 named styles
plus the manifest default. For runtime matching, omit the pair argument.
The returned choice's ink ids name palette entries; they aren't Settings
preset ids and must not be passed back through `themeFor` or `inkPairFor`.

`launchTheme` and `LAUNCH_SPLASH_THEMES` retain the existing preset-only
resource names and shape until #656 changes the plugin and runtime together.
Use `paletteSplashThemeFor(choice)?.name ?? null` for the new runtime style
name; keep `launchTheme`'s colours for the app's actual custom inks. Generate
native styles from the new helper's colours. The helper starts with each
palette ink's mode tone and applies readability correction for the chosen
backgrounds. The manifest default remains the shipped app theme.

Before merging #656, measure APK size and full build time against the parent
spec's limits (+5 MB, +2 minutes). Both native tickets need a full ti build.
