# Shared colour tokens

`colours.css` holds the default light and dark colours, Recap colours and neutral
tone ramp for both apps. It is a CSS asset, with no package or runtime dependency.
Typography stays in each app.

Import it after Tailwind and the app's theme setup. The phone does this in
`apps/mobile/global.css`, after uniwind. The desktop's Tailwind 4 stylesheet should
import `../../packages/theme/colours.css` from `apps/desktop` too. Its theme setup
must register the semantic `--color-*` names with Tailwind and define the `light`
and `dark` variants; uniwind supplies that setup on the phone. The shared file
contains the values, so neither app should copy them into its own stylesheet.

Core keeps its TypeScript mirror in `packages/core/src/theme.ts` for native props
and contrast checks. `apps/mobile/src/theme/tokens.test.ts` compares the shared CSS
against Core, including the Recap colours and tone ramp. Update both when a colour
changes, and run the Core and mobile tests. The phone's settings still override
the defaults at runtime.
