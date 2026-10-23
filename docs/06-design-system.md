# UI Design System

## Intent
"Editorial Daylight" (chosen by Owen, 24 Oct 2026): a warm, light, magazine-like workspace for people who live in it all day. Serif headings (Newsreader) over Instrument Sans, pill navigation along the top, generous rounded cards. The practice whose records are open sets the accent colour (active pill, primary buttons, focus), so staff always know whose work they are in. Each person can switch to a dark theme or follow their device from the account menu (stored in `users.ui_theme`, default light).

## Shell (`src/components/shell`)
- Top bar: logo, pill navigation (5 items on large screens, 7 on very wide ones, the rest under "More"), search (Ctrl K), workspace switcher, "New" quick actions, account menu (appearance, account, sign out). Below `lg` the navigation is a drawer.
- `/today` ("My day") is where everyone lands: greeting in their own time zone, a summary of what needs them, a "Needs you" feed, practice tiles in each practice's brand, and "Coming up" (follow-ups now; calendar items from Milestone 2). Real records only.
- `theme.ts` holds each practice's palette: a light accent, a dark accent and a tile style. Practices without a tuned palette use their stored brand colour.

## Tokens (`src/app/globals.css`)
| Token | Light | Use |
|---|---|---|
| `paper` | `#f4f1ec` | Page background |
| `surface` | `#ffffff` | Cards, inputs |
| `sunken` | `#f1ede6` | Quiet fills, hover |
| `hairline` / `hairline-strong` | `#e2ddd3` / `#d3ccbf` | Borders |
| `ink` / `ink-2` / `muted` | `#1d2230` / `#4a5162` / `#5f6575` | Text, by importance |
| `accent` / `accent-ink` | practice colour / text on it | Active navigation, primary buttons, focus |
| `hub-red` | `#dd1929` | Badges, "New", Hub marks |
| `ok` / `warn` / `danger` | green / amber / red pairs with soft backgrounds | Status only |

The dark theme redefines the same tokens under `[data-theme="dark"]` (and `[data-theme="system"]` when the device prefers dark). Practice-coloured text uses `.practice-ink` with `--c-l` / `--c-d` so it stays readable in both. Use `.light-only` / `.dark-only` for assets that differ (the logo).

Radii: 6 / 12 px for controls, 16–28 px for cards and the hero. Shadows only on floating layers (menus, dialogs).

## Type
Instrument Sans throughout. 14 px base, 13 px for dense tables and secondary text, 22 px page titles, 26–28 px for headline counts. Tabular figures (`.num`) for references, counts, dates and money. Sentence case everywhere; no uppercase labels.

## Components (`src/components/ui`)
- `Button` (primary, secondary, ghost, danger; sm, md, icon)
- `Input`, `Textarea`, `Select`, `Checkbox`, `Field` (label, hint and error wired with `aria-describedby`)
- `Badge` tones, `Panel` + `PanelHeader`, `PageHeader`, `Facts` (definition list), `Notice`, `EmptyState`
- `Dialog` (Radix), command palette (cmdk), dropdown menus (Radix)
- `LocalTime` renders times in the viewer's own time zone; `DateTimeInput` submits ISO timestamps with the person's offset
- Tables share `tableClass` styles; rows are 44 px high

## Writing
Plain verbs, sentence case, active voice. Buttons say what happens ("Route enquiry", "Convert to client"). Empty states explain what will appear and how. Errors say what to fix. Modules not yet built say so, with their release number.

## Accessibility
Visible focus ring on every control, labels on every input, keyboard alternatives for drag-and-drop (a stage selector on each board card), reduced motion respected, colour never the only signal. Automated axe checks run in the end-to-end suite (WCAG 2 A/AA, no serious or critical violations allowed).
