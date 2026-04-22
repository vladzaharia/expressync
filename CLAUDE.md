# ExpresSync — project notes for Claude

## Admin UI layout conventions

The admin UI is built on three primitives. Honor these so pages stay coherent
across listing, detail, and modal surfaces.

### Primitives

- `components/PageCard.tsx` — page-root card. Carries `BorderBeam`,
  `GridPattern`, `BlurFade`, `colorScheme`, `headerActions`. One per page.
- `components/shared/SectionCard.tsx` — lightweight sub-section card. No
  BorderBeam. Supports `accent?: AccentColor` → tinted header wash + border.
- `components/shared/StatStrip.tsx` — top-of-page stat strip (icon-well +
  value + uppercase label). `StatStripItem` supports `href`, `active`,
  `disabledWhenZero`, `dashed`, `warn`, per-item `tone` overrides.
- `components/shared/MetricTile.tsx` — flex-row metric for detail-page bodies
  (inside `SectionCard`). Don't use on listing pages — use `StatStrip`.

### Listing pages (`routes/*/index.tsx`)

Canonical order — every listing page follows this:

```
SidebarLayout
  PageCard              ← the page root (one only)
    StatStrip?          ← top stats, inside the PageCard
    FilterBar?          ← filters, always between stats and table
    Table
    Pagination
```

- Stats and filters live **inside** the `PageCard`. Do not place them above it
  (Sync page's pre-refresh layout did this; don't repeat it).
- The filter bar renders **unconditionally** when the page has one — never mount
  it conditionally on "filter active" (layout reflow).

### Detail pages (`routes/*/[id].tsx`)

Canonical structure — one root `PageCard`, N `SectionCard` children:

```
SidebarLayout
  PageCard               ← one only; accent = page colorScheme
    HeaderStrip?         ← optional pills / identity strip
    SectionCard accent=  ← sub-section
    SectionCard accent=  ← sub-section
    ...
```

- **Never** stack multiple `PageCard`s — every extra `BorderBeam` dilutes its
  signalling value. Collapse into one PageCard + SectionCards.
- For sub-sections, always use `SectionCard`. Do not hand-roll
  `rounded-md border bg-background p-4` boxes.
- Pass the same accent to every `SectionCard` on the page unless the section
  represents a semantic state that warrants a tone override (see below).

### Colour strategy

- **One accent per page**, inherited from `PageCard.colorScheme`. That same
  value is passed to `StatStrip accent=` and every `SectionCard accent=`.
- **Tone overrides are semantic only**:
  - `amber` = warning (e.g. overdue, offline when > 0)
  - `rose` = error (e.g. failed, deactivated)
  - `emerald` = success (e.g. paid, activated)
  - `muted` = neutral / inactive / zero-valued
- Colour comes from saturation of the accent (wash), not from mixing hues. Never
  pick per-tile accents just because it looks lively — that's confetti.

### Accent wash

- `StatStrip` cells and `SectionCard` headers get
  `bg-{accent}-500/5 border-{accent}-500/20`. Defined in
  `src/lib/colors.ts#stripToneClasses`.
- Page / card bodies stay on `bg-card` so body text has contrast.
- If you need a new accent / wash combination, add it to `stripToneClasses` —
  Tailwind's JIT requires the class strings to exist statically.

### Interactive stats

- Filter-shortcut cells use `StatStripItem.href` + `active` + (usually)
  `disabledWhenZero: true`. The primitive applies `aria-current="true"`, 2px
  ring, and `aria-disabled` automatically.
- Never mix interactive and non-interactive cells in the same strip.

### BorderBeam

- Reserved for **live / in-progress** semantics: page root (via PageCard),
  active sync, live charging session, the Scan Tag modal's waiting/detected
  states. Do not apply decoratively.

### Modals

- Modals accept `accent?: AccentColor` and derive `BorderBeam` from
  `borderBeamColors[accent]` — no hard-coded CSS variables.
- Error surfaces use the shared tonal language (destructive text for errors,
  amber for warnings). Recoverable-error modals standardise on "Try again" as
  the retry verb and surface `R` as a keyboard shortcut.
- If the modal has a countdown, `ScanCountdownRing` accepts any accent via
  `tone={accent}` and flips to `amber` when the timer is near expiry.

### Things to delete rather than patch

When touching an older page, replace legacy ad-hoc constructs rather than
wrapping them:

- Hand-rolled `rounded-md border bg-background p-4` sub-cards → `SectionCard`.
- Per-page bespoke stat tiles → `StatStrip`.
- Stacked `PageCard`s → one `PageCard` + `SectionCard`s.
- Direct shadcn `Card` inside a page body → `SectionCard` (so accent, spacing,
  and header patterns stay consistent).
