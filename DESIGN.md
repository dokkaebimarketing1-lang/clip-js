# ClipJS Studio Design System

## 1. Atmosphere & Identity

ClipJS is a focused production control room: dark, compact, and calm enough for long editing sessions. Its signature is a fuchsia-guided workflow layered over quiet charcoal surfaces, with status color reserved for production readiness.

## 2. Color

| Role | Token / utility | Value | Usage |
|---|---|---|---|
| Canvas | `--clip-bg` | `#08090d` | App background |
| Surface | `--clip-surface` | `#11131a` | Panels and cards |
| Raised surface | `--clip-surface-raised` | `#171a23` | Elevated regions |
| Reference surface | `--clip-reference-surface` | `#17151d` | Reference cards |
| Border | `--clip-line`, `border-white/10` | white at 9–10% | Panel separation |
| Text | `--clip-text`, `text-white` | `#f6f7fb` | Primary copy |
| Muted text | `--clip-muted`, `text-gray-400/500` | cool gray | Supporting copy |
| Accent | `--clip-accent`, `fuchsia-300/500` | `#d946ef` ramp | Active tabs, focus, key actions |
| Success | `--clip-success`, `emerald-200/400` | `#34d399` ramp | Locked and approved |
| Warning | `amber-200/400` | Tailwind amber ramp | Review required |
| Pending | `gray-400/600` | Tailwind gray ramp | Missing or waiting |

## 3. Typography

- Primary: Noto Sans KR Variable, then the project sans fallback.
- Mono: inherited monospace for timecodes, hashes, and production identifiers.
- Scale: `text-[10px]` metadata, `text-[11px]` labels, `text-xs` supporting copy, `text-sm` default UI, `text-lg` card headings, `text-2xl/3xl` workspace headings.
- Strong hierarchy uses `font-black`; body copy uses medium or regular weight with relaxed line height.

## 4. Spacing & Layout

- Base unit: 4px, expressed through the Tailwind spacing scale.
- Compact clusters use 8–12px gaps; cards use 16–24px padding; major workspace groups use 24–40px separation.
- The studio is a bounded full-height shell. Fixed navigation and sidebars remain visible; each workspace or sidebar body owns its vertical scroll with `min-h-0` and `overflow-y-auto`.
- Sidebar widths are structural contracts and are not changed by panel content.

## 5. Components

### Studio Tab Strip
- Structure: semantic buttons in a fixed header row.
- States: muted default, fuchsia underline active, visible focus ring, gray disabled.
- Layout: equal-width cluster; the sidebar body below is the scroll owner.

### Reference Card
- Structure: framed thumbnail, label/name, compact status badge, optional external link.
- Variants: character, location, prop, crowd, missing image, broken image.
- States: emerald locked, amber review, gray missing; failed media falls back to a stable placeholder without changing card geometry.
- Accessibility: descriptive image alt text, semantic external links, no color-only status.

### Empty Panel
- Structure: icon tile, direct heading, one guidance paragraph.
- Styling: dashed subtle border, quiet surface, fuchsia icon accent.

## 6. Motion & Interaction

- Motion is limited to meaningful hover, focus, and state feedback using existing color transitions.
- No decorative looping motion. Respect the global reduced-motion override.

## 7. Depth & Surface

- Strategy: mixed tonal shift and subtle borders.
- Cards use `border-white/10`, low-opacity white fills, and 16px radii. Shadows are reserved for major elevated workspace surfaces, not sidebar list items.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA, full keyboard reachability, visible fuchsia focus rings, stable image dimensions, and text labels for every status.
- External reference links disclose a new tab through accessible text/title and use safe `rel` attributes.
- The editor shell uses `100dvh` so mobile browser chrome cannot create a trapped or clipped viewport; internal workspace and sidebar bodies remain the named scroll owners.
