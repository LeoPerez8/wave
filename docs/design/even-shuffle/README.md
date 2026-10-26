# Even Shuffle icon review

Tracked in [#702](https://github.com/LeoPerez8/wave/issues/702). Option 3, **Braid**, was chosen. `EvenShuffleIcon` draws it for every shuffle control while Even Shuffle is chosen.

`review.png` shows each option next to the Real and Smart Shuffle references at the sizes the controls use: the Queue toggle (20dp, 1.5 stroke, graphite while off), a menu row (22dp, 1.75), a page's Play and Shuffle line (24dp, 1.5), a menu card (24dp, 1.75) and enlarged. It uses the light and dark colours from `apps/mobile/global.css`.

1. **Even sign.** An equals sign takes the top arrowhead's place, as the spark does for Smart Shuffle. It's clear at 20dp, but it says "the same" rather than "taking turns", and next to the line it reads like a list or sort icon.
2. **Zigzag.** An up-down stroke takes the top arrowhead's place. At small sizes it reads as an "N" or a lightning bolt.
3. **Braid (selected).** The two lanes cross twice. The top lane passes over at the first crossing and the bottom lane at the second, so they take turns. It keeps Real Shuffle's arrowheads, so it still reads as shuffle, and at 20dp the double crossing sets it apart from Real Shuffle's single one.
4. **Turn circles.** Small circles stand for two artists at the lanes' tails. It reads like a merge or network diagram.

Each option uses a 24 × 24 viewBox, rounded caps and joins, and `currentColor`, the same as Wave's Tabler line icons.
