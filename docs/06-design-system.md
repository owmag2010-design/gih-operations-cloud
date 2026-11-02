# UI Design System

## Intent
"Hub Daylight" (Owen, 2 Nov 2026; replaces "Editorial Daylight" of 24 Oct): the thegih.com palette (paper #F6F5F1, stone #F3F2EE, line #E6E7E5, ink #202326, navy #1B263B, Hub red #DD1929) in a clean sidebar layout after Botpress and Boundless. Serif headings (Newsreader) over Instrument Sans, white cards with soft shadows (`shadow-card`, `shadow-lift`), the website's own photography on the dashboard. The practice whose records are open sets the accent colour (active pill, primary buttons, focus), so staff always know whose work they are in. Each person can switch to a dark theme or follow their device from the account menu (stored in `users.ui_theme`, default light).

## Shell (`src/components/shell`)
- Left sidebar (264px): logo, workspace switcher, navigation grouped as work / Client work / Insights with Settings pinned at the bottom, account menu (appearance, account, sign out) at the foot. Below `lg` the sidebar is a drawer that closes after navigating.
- Top bar (64px): where you are (workspace / section), search (Ctrl K) and "New" quick actions. No navigation in the top bar.
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
