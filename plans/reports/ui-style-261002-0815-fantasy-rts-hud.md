# Fantasy RTS HUD restyle

Date: 2026-10-02. Scope: `index.html`, `src/style.css`, `src/ui/hud.js`.

## Visual language

An original design in the classic fantasy-RTS style: dark carved stone panels in gold-trimmed iron frames, with beveled metal controls. No third-party art is used. Every ornament is an SVG data URI drawn for this project and declared as a custom property on `:root`.

| Token | What it is |
|---|---|
| `--frame` | 96x96 nine-slice frame: iron edge, gold rail with a diagonal light gradient, inner dark bevel and a faint highlight, and a rune-gem clasp (chamfered gold cap plus an amber diamond) in each corner. Applied with `border-image` on a `::before` overlay (`pointer-events: none`), so scrolling content never moves it. |
| `--stone` | `feTurbulence` grain plus slow mottling, tiled at 240px. It is rasterized once and not animated. |
| `--stone-bg` | Stone texture over a warm top highlight and a dark-umber gradient. This is the panel background. |
| `--divider`, `--rune`, `--crest` | Filigree rule with a centre gem, a small rune-diamond bullet, and the gem crest on the selection console's top rail. |
| `--plaque`, `--plaque-rim`, `--socket` | Raised engraved plaques (wave cards, tower cards, perks, spoils) and recessed sockets (item slots, element tabs, resource readouts). |

The palette is iron `#0b0806`, bronze `#c89a45`, gold `#f2c766` and warm parchment text `#f0e6cf` (muted `#ab9f8a`). Fonts are Cinzel for headings and buttons, Inter for body text and numbers, and Cinzel Decorative (Google Fonts, OFL) for the menu title and end-screen heading only. The in-game wave banner stays in Cinzel because the Decorative "1" reads as "I".

## What changed

- **Panels:** all `.panel`s, the tooltip, perk queue, spoils, alert, menu choices, how-to cards, credits and end stats use the shared frame. `backdrop-filter` is gone from panels, choices and the modal overlay; the backgrounds are now near-opaque instead.
- **Top bar:** flush to the top edge, with a stone background and an iron/gold/iron bottom rail. Resource readouts are recessed sockets; the life, timer, XP and mana bars are metal-rimmed troughs with lit gradients. The speed toggles are iron with a gold "on" state, and the settings button is a round bronze-rimmed boss.
- **Buttons:** `.btn` is forged iron with a bronze inner rim. `.gold` is a polished gold bar, `.danger` a ruby bar, and `.big` has rune diamonds at both ends. Ability buttons (`.act`) are sapphire gems with a gold ring for autocast.
- **Left and right columns:** start at `64px` to sit under the new bar. Element tabs are gem sockets; the active one glows in its element colour and has a diamond pointer. Tower cards are plaques with socketed icons and a bronze-rimmed tier badge. Rarity group labels have a rule that fades out.
- **Selection panel:** now docked to the bottom edge as a command console, with a gem crest on its top rail and a framed portrait socket. Stats sit in an inset tray and the command row is separated by a gold rule. The width is now `720px`, the minimum width is unchanged, and the `<=1280px` media rule is kept.
- **Tooltip:** a "dark vellum" scroll (sepia gradient plus grain, gold frame). I chose this over light parchment because the tooltip's inline rarity, element and attack colours are tuned for dark backgrounds, so a light parchment would break contrast.
- **Menu:** the title is embossed gold with a filigree divider. The options sit on one framed stone tablet (`.opts` gains the `panel` class in `index.html`). Choice plates have a dimmed frame that turns fully gold with a glow when selected. The how-to cards and credits are framed too.
- **Settings and end screen:** framed modal, uppercase engraved heading with a divider, and socketed stat tiles on the end screen.
- **Unchanged:** rarity and element colours, all ids, `data-*` attributes and event wiring. Every new size uses `calc(var(--s) * Npx)`; only 1px hairlines and a few legacy negative offsets are raw px.

## hud.js changes

1. **Requested by the coordinator:** the shop lists only first tiers. Both `availableTowers()` (build mode) and the random-mode catalog now filter on `t.tier === 0`; the draft tab is unchanged.
2. **Bug fix:** the `perkReady` handler now calls `renderPerkQueue()`. Before this, the "Perks to choose" panel only refreshed after a perk was chosen, so it never appeared when a tower first earned a perk.

## Verification

- I checked screenshots at 1920x1080 and 2560x1440: menu, how-to, HUD with a selected tower and items, tooltip, settings, end screen, boss spoils, perk queue and the perk offer. There were no page errors.
- `npx vite build` passes; the chunk-size warning was there before this change.
- The dev server on port 5321 has been stopped.

Screenshots are in `/private/tmp/claude-501/-Users-trungtran-code-youtd/ae547f90-1bde-4c76-8bee-db036b755eac/scratchpad/shots/`:
- `final-{menu,howto,hud,tip,settings,end,extras}-{1920,2560}.png`
- `before-{menu,hud}-1920.png` (baseline)
- `z3-zoom-{left,console}.png` (2x detail crops)

The original files are backed up in the scratchpad as `style.before.css` and `index.before.html`.

## Known pre-existing overlaps (not changed)

- The transient wave banner draws over the centre stack (spoils) for about 3 seconds.
- Toasts at `bottom: 200px` can overlap a tall selection console, for example when a perk offer is open.
