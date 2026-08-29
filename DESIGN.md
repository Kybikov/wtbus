---
name: Vivat Bus Operations
description: Dark-first dispatch dashboard with graphite surfaces and disciplined Vivat gold accents.
colors:
  graphite-background: "oklch(0.153 0.006 107.1)"
  graphite-card: "oklch(0.228 0.013 107.4)"
  graphite-muted: "oklch(0.286 0.016 107.4)"
  graphite-foreground: "oklch(0.988 0.003 106.5)"
  graphite-muted-foreground: "oklch(0.737 0.021 106.9)"
  vivat-gold: "oklch(0.78 0.15 82)"
  vivat-gold-ink: "oklch(0.18 0.015 80)"
  live-green: "oklch(0.75 0.12 230)"
  status-sky: "oklch(0.75 0.12 230)"
  status-violet: "oklch(0.77 0.12 295)"
  status-positive: "rgb(16 185 129)"
  border: "oklch(1 0 0 / 10%)"
typography:
  display:
    fontFamily: "var(--font-sans)"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "1.2"
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "var(--font-sans)"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: "1.2"
    letterSpacing: "-0.035em"
  title:
    fontFamily: "var(--font-sans)"
    fontSize: "1rem"
    fontWeight: 700
  body:
    fontFamily: "var(--font-sans)"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "var(--font-sans)"
    fontSize: "0.75rem"
    fontWeight: 700
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  app: "1.5rem"
  surface: "calc(var(--radius) * 1.35)"
spacing:
  compact: "0.625rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.vivat-gold}"
    textColor: "{colors.vivat-gold-ink}"
    rounded: "{rounded.lg}"
    padding: "0 1rem"
    height: "2.25rem"
  button-ghost:
    textColor: "{colors.graphite-foreground}"
    rounded: "{rounded.lg}"
    size: "2rem"
  card-surface:
    backgroundColor: "{colors.graphite-card}"
    rounded: "{rounded.surface}"
    padding: "1.25rem"
---

# Design System: Vivat Bus Operations

## Overview

**Creative North Star: "The Graphite Dispatch Desk"**

Vivat Bus is an Operate-mode system: a calm, precise desk for dispatchers who need to scan a day of moving vehicles without visual theatre. The dark theme is the signature expression—near-black graphite carries the application chrome and cards, while Vivat gold identifies primary action, brand moments, and progress. The light theme retains the same hierarchy for individual preference; it is an alternate environment, not a separate visual language.

The dashboard is deliberately data-transparent. Demo status is stated in the sidebar and in schedule context instead of making the information look falsely live. The supplied black-and-gold Vivat Bus mark anchors navigation. Personal preferences can adjust accent, theme, corner radius, and density, but never the shared information architecture.

**Key Characteristics:**

- Operational scanability before decoration.
- Graphite tonal layering, thin translucent dividers, and sparse gold emphasis.
- Generous rounded containment with compact, tabular operational data.
- Desktop planning uses vehicle-and-driver lanes to make resource conflicts legible at a glance.
- Mobile removes secondary navigation and replaces dense schedules with semantically complete trip cards.

## Colors

The palette is a warm-neutral graphite foundation with gold used as a navigation beacon, not as a blanket fill.

### Primary

- **Vivat Gold:** primary actions, progress fills, avatar accents, and selected emphasis use the runtime gold token.
- **Vivat Gold Ink:** dark text placed on gold maintains a grounded, branded contrast relationship.

### Secondary

- **Live Green:** the online/positive state is reserved for operationally good or connected signals.
- **Sky Status:** a cool blue status chip distinguishes an in-progress trip from gold action emphasis.
- **Violet Status:** violet distinguishes an assigned state; it is informational, not a second brand color.

### Neutral

- **Graphite Background:** the dark page field.
- **Graphite Card:** raised content and popover surface, differentiated tonally rather than with heavy shadow.
- **Graphite Muted:** selected navigation, track, and soft control fill.
- **Graphite Foreground / Muted Foreground:** bright primary text and quieter secondary information.
- **Translucent Border:** the dark divider token gives containers definition without visible boxiness.

**The Gold-is-a-Signal Rule.** Reserve Vivat gold for the main action, meaningful progress, brand identity, and intentional focus. Do not use it as a default card, table, or navigation background.

## Typography

**Display Font:** `var(--font-sans)`

**Body Font:** `var(--font-sans)`

**Character:** A straightforward sans-serif hierarchy makes the dashboard legible at speed. Tight tracking belongs only to large summary figures and the page title; labels and table cells stay plain, practical, and compact.

### Hierarchy

- **Display:** used for the page title and large metrics, with bold weight and negative tracking to make operational values read as a single unit.
- **Headline:** used for the mobile page title when the desktop scale is unavailable.
- **Title:** bold, compact headings for cards, navigation, and route names.
- **Body:** the default explanatory and table text size; muted body text carries supporting context.
- **Label:** compact bold labels for statuses, controls, and metric details. Numerical time, percentage, and monetary values use tabular figures.

**The Numbers-Align Rule.** Use tabular numerals for times, counts, percentages, and currency wherever values may be scanned down a column.

## Layout

The desktop shell is a single rounded application frame with a fixed 15rem sidebar and a flexible content pane, capped at 1800px. The header is a 4rem utility strip; the content keeps a 1.5rem desktop rhythm and uses a four-card metric grid at extra-large widths. The content area changes to a main-plus-rail layout for schedule and fleet load rather than forcing one long dashboard column.

The trips planner is a contained week-and-day module. Its date rail pairs previous/next-week icon controls with the active week range and seven equal day cells; a selected day receives the quiet secondary surface, while inactive days remain muted until hover. Day selection must update the adjacent date and fleet-context line. The regular / individual filter is a compact segmented control: its selected pill is gold, inactive choices stay text-only, and filtering changes both the visible trips and the vehicle-count context.

At the medium breakpoint and above, the planner becomes a lane-based calendar: a fixed 15rem descriptor column names the vehicle, driver, and capacity, and a horizontally dense time grid runs from 06:00 to 24:00 in 2-hour increments. Each trip block's left edge and width must be derived from its disclosed start and end times across that 18-hour window; never use approximate or purely aesthetic placement. Blocks keep the route, time interval, and type readable in the lane, while distinct sky, gold, slate, and violet treatments help separate concurrent work without replacing the text label.

Below the medium breakpoint, replace the timeline—not merely its labels—with vertically stacked trip cards. Preserve route, full time interval, vehicle, and regular-versus-individual type in every row; the driver lane metadata may yield first. This is prioritization, not horizontal scrolling.

Density is a personal preference: comfortable is the default; compact reduces dashboard vertical padding, metric-card minimum height, and trip-row padding. Radius is independently selectable in small, medium, and large modes.

## Elevation & Depth

Depth is primarily tonal and structural. Cards are separated with the border token and a distinct graphite surface; the outer application frame carries the only broad ambient shadow. Popovers receive a stronger black shadow so they can float over operational data without a modal treatment. Hover feedback uses color shifts; interactions should not introduce decorative lift except the existing pressed-state one-pixel translation.

**The Quiet Frame Rule.** Keep most dashboard surfaces flat and border-defined. Elevation communicates containment or temporary overlay state, never decoration.

## Shapes

The form language is softly squared and generously rounded: controls and navigation use the current radius scale, cards expand it to `calc(var(--radius) * 1.35)`, and the application frame uses the independently configurable app radius. Pills are reserved for status and progress semantics; avatar identity is circular. Fine one-pixel borders are the default edge treatment.

## Components

### Buttons

**Character:** compact, confident controls that keep primary action obvious.

- **Shape:** softly rounded (large radius by default) with a 2.25rem large action height.
- **Primary:** Vivat gold surface with dark gold-ink text; the create-trip action is the only large filled CTA in the primary view.
- **Hover / Focus:** primary darkens through opacity; keyboard focus uses the ring color with a translucent three-pixel ring. Pressed controls shift down one pixel.
- **Ghost / Secondary:** ghost buttons are icon-first header and row actions, gaining muted fill on hover; secondary controls use a graphite-muted fill.

### Cards / Containers

**Character:** quiet, rounded operational modules.

- **Corner Style:** enlarged rounded rectangle using the surface radius.
- **Background:** graphite-card in dark mode; equivalent light card surfaces in the light preference.
- **Shadow Strategy:** cards are border-defined; only the application frame and popover receive ambient shadow.
- **Border:** one-pixel translucent border.
- **Internal Padding:** typically 1.25rem, reduced where rows require high information density.

### Inputs / Fields

**Character:** low-noise utilities rather than form-heavy decorations.

- **Style:** background-matched search and select fields with a one-pixel border and rounded control corners.
- **Focus:** ring-colored two-pixel focus indication on custom controls and the global button focus treatment.
- **Search:** desktop search is intentionally hidden below the medium breakpoint; it does not crowd the mobile header.

### Chips

**Character:** compact semantic state markers.

- **Style:** bold 0.75rem text in a full pill with light translucent color fill.
- **State:** sky for in transit, gold for boarding, muted graphite for new, and violet for assigned. Positive connectivity is green text with a small circular marker.

### Planner Controls

**Character:** compact controls that set the working day and the dispatch scope without competing with the schedule itself.

- **Date rail:** previous/next outline icons frame a clear week range and demo-year context; seven equal weekday/date cells form one quiet rounded rail. The selected date uses the secondary surface, not gold.
- **Trip filters:** `Все`, `Регулярные`, and `Индивидуальные` sit beside the filter icon as text-first pills. Use gold only for the active scope; inactive scopes remain muted and gain contrast on hover.
- **Context:** the selected full date and affected vehicle count align opposite the filters on desktop and follow them on mobile. It is a live consequence of date and filter state, never detached decorative copy.

### Navigation

**Character:** low-contrast vertical wayfinding with one clear active destination.

- **Desktop:** a 15rem sidebar begins with the black logo tile and company context, then compact 2.5rem navigation rows. The active item has a muted graphite fill; inactive items are muted until hover.
- **Mobile:** the sidebar is removed, the logo tile and current page title move to the header, and primary actions remain available.
- **Demo disclosure:** the sidebar's final muted panel states that displayed operations are preview data.

### Fleet Load

**Character:** a precise progress readout, not a decorative chart.

- **Structure:** vehicle name and context align with a bold tabular percentage; a short 0.5rem track maps load directly below.
- **Color:** Vivat gold fills the muted track; do not introduce multi-color gauges for ordinary load levels.

### Vehicle Timeline

**Character:** a resource schedule, not a generic chart.

- **Desktop structure:** one vehicle-and-driver lane per resource, aligned to a 06:00–24:00, 2-hour time grid. Keep the label column fixed while the schedule field carries the time divisions.
- **Trip blocks:** position each block from its actual disclosed interval, then retain the route, interval, and `Регулярный` or `Индивидуальный` label inside the block. Tone is secondary confirmation; it must not be the only type or timing signal.
- **Mobile structure:** render the filtered result as tap-ready cards with a tonal vehicle icon. Every card retains route, time interval, vehicle, and a concise `Рейс` / `Трансфер` type label; do not compress the mobile view into a miniature timeline.

### Create Trip Panel

**Character:** a focused operational form that makes resource conflicts visible before dispatch turns into a phone call.

- **Structure:** the create action opens a bottom panel on phone and a contained dialog on larger screens. It collects trip type, route, local departure/arrival time, vehicle, driver, and an optional note in that order.
- **Resources:** vehicle and driver choices are fetched from the tenant-scoped operational API when the panel opens; the vehicle's capacity is informational and never manually entered.
- **Failure behavior:** loading, unavailable resources, validation, and a driver/vehicle overlap stay within the form as clear recovery messages. A conflict never closes or clears the dispatcher’s entered route.
- **Completion:** a successful save closes the panel, announces the created route, and refreshes the day timeline from the database.

### Trip Card and Status Flow

**Character:** a compact operational checkpoint, not an edit-heavy profile page.

- **Structure:** selecting a timeline block or mobile trip card opens a concise sheet/dialog with route, current status, timing, capacity, vehicle, and driver.
- **Progression:** only the next valid dispatch action is shown: confirmation for a new trip, start for an assigned trip, and completion for an active trip. The API, not the client, enforces these transitions.
- **Cancellation:** cancellation is visually destructive and asks for a second explicit confirmation in the card. It remains available for non-final states but never competes with the normal primary workflow.

## Do's and Don'ts

### Do:

- **Do** lead each view with one operational decision and one obvious gold primary action.
- **Do** use graphite tonal layers and the translucent border token to separate dense modules.
- **Do** keep demo/preview data visibly disclosed in the operational context.
- **Do** preserve personal accent, light/dark/system, radius, and density controls while retaining the shared layout.
- **Do** use the date rail to make the selected day and week context explicit before showing its schedule.
- **Do** map each desktop trip block exactly to its disclosed interval on the 06:00–24:00 timeline.
- **Do** collapse the planner semantically on mobile: retain route, time, vehicle, and regular-versus-individual type before driver lane metadata.

### Don't:

- **Don't** flood cards, tables, or sidebars with Vivat gold; its scarcity makes the main action readable.
- **Don't** replace the responsive mobile hierarchy with a horizontally scrollable desktop table.
- **Don't** use color, block length, or vertical position as the only indication of a trip's type or time.
- **Don't** let a filter leave a stale vehicle-count context or hidden lane/card state behind.
- **Don't** use decorative chart colors when a single load/progress value is being communicated.
- **Don't** imply that the current dashboard data is live when the product is explicitly in demo mode.
