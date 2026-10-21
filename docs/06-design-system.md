# UI Design System

## Intent
A calm working tool for people who live in it all day: dense records, quiet chrome, fast keyboard paths. One memorable element: the active firm's brand colour runs down the sidebar edge, so staff always know whose records they are in. The Hub uses its red; Veritas, Mimshac and Nextmove use their own colours (editable in firm settings).

## Tokens (`src/app/globals.css`)
| Token | Value | Use |
|---|---|---|
| `paper` | `#fbfaf8` | Page background |
| `surface` | `#ffffff` | Panels, inputs |
| `sunken` | `#f2f0ec` | Table headers, hover, quiet fills |
| `hairline` / `hairline-strong` | `#e3dfd8` / `#cfc9bf` | Borders |
| `ink` / `ink-2` / `muted` | `#24221f` / `#47433d` / `#6e685f` | Text, by importance |
| `accent` | `#2b4c7e` | The only interactive colour: buttons, links, focus |
| `ok` / `warn` / `danger` | green / amber / red pairs with soft backgrounds | Status only |
| `firm` | per workspace | Sidebar band, pipeline bars |

Radii: 4 / 6 / 10 px by element size. Shadows only on floating layers (menus, dialogs).

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
