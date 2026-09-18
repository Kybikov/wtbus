---
name: Vivat Public Booking
description: Passenger booking within Vivat's inherited graphite and gold system.
colors:
  vivat-gold: "#e9b74d"
  vivat-gold-ink: "#241e10"
  graphite-background: "oklch(0.153 0.006 107.1)"
  graphite-card: "oklch(0.228 0.013 107.4)"
  graphite-foreground: "oklch(0.988 0.003 106.5)"
  graphite-muted-foreground: "oklch(0.737 0.021 106.9)"
  border: "oklch(1 0 0 / 10%)"
typography:
  headline:
    fontFamily: "var(--font-sans)"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "var(--font-sans)"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "var(--font-sans)"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "var(--font-sans)"
    fontSize: "0.75rem"
    lineHeight: "1rem"
rounded:
  control: "var(--radius-lg)"
  field: "var(--radius-xl)"
  input: "var(--radius-2xl)"
  surface: "var(--rb-r-lg)"
spacing:
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
  section: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.vivat-gold}"
    textColor: "{colors.vivat-gold-ink}"
    rounded: "{rounded.control}"
    height: "2.75rem"
    padding: "0 1rem"
  button-search:
    backgroundColor: "{colors.vivat-gold-ink}"
    textColor: "{colors.vivat-gold}"
    rounded: "{rounded.control}"
    height: "2.75rem"
    padding: "0 1.5rem"
  card-trip:
    backgroundColor: "{colors.graphite-card}"
    rounded: "{rounded.surface}"
    padding: "1.25rem"
---

# Design System: Vivat Public Booking

## Overview

**Creative North Star: "The Graphite Dispatch Desk"**

This document records the public passenger addition only; the root DESIGN.md remains the authority for the inherited Vivat world. The anonymous Ukrainian booking surface uses the same practical sans-serif hierarchy, graphite tonal layers, rounded containment, and gold identity. Its Operate mode makes route selection and checkout easy to scan.

**Key Characteristics:**

- A gold search surface against graphite inventory and checkout modules.
- Tabular trip times and prices with plain-language supporting context.
- Responsive cards and a grouped three-step form.

Evidence: `components/public-booking.tsx`, `components/filtering-8.tsx`, `components/wizard-2.tsx`, their shared shadcn controls, `app/globals.css`, and `app/layout.tsx`. The frontmatter records the default dark palette; inherited light-theme neutrals remain runtime theme values.

## Colors

Warm graphite provides the reading field; Vivat gold marks the search surface, primary actions, price, and checkout progress.

### Primary

- **Vivat Gold:** the public CSS override used for search containment, selection actions, progress, and price emphasis.
- **Vivat Gold Ink:** text on gold and the inverted search action.

### Neutral

- **Graphite Background / Card:** the page field and quiet result, facet, and checkout surfaces.
- **Graphite Foreground / Muted Foreground:** primary journey information and secondary explanation.
- **Translucent Border:** container edges and internal separators.

**The Search-and-Signal Rule.** The search rail may use a full gold surface; result and checkout cards remain neutral, with gold identifying action and meaningful values.

## Typography

**Display Font:** Inter through `var(--font-sans)`, with sans-serif fallback.
**Body Font:** the same stack.

The ramp is compact and functional: the search heading grows from the recorded headline role to 2.25rem at the small breakpoint. Section headings use the title role; body copy and controls use the body size, with quieter labels and context at the label size. Trip times and prices use bold 1.25rem, with times growing to 1.5rem on larger cards. Form inputs use 1rem on mobile and the body size from the medium breakpoint.

**The Numbers-Align Rule.** Keep trip times, prices, passenger quantities, and progress counts tabular. The selectable booking reference uses the existing mono face for identification, not display typography.

## Layout

Header, main, and footer share a 1536px maximum width. Horizontal gutters increase from 1rem to 2rem at 640px and 3rem at 1024px. The public root stays at 16px independently of staff UI scale. Panels use 1.25rem padding, generally growing to 1.5rem or 2rem where the form requires it.

Search fields stack on narrow screens, become two columns at 640px, and form a single rail at 1024px. Results pair a 240px facet rail with flexible inventory at 1024px; below that breakpoint, a disclosed Filters action toggles the facets. Cards retain route, times, departure and overnight arrival dates, duration, availability, price, and choice action while changing from stacked to horizontal at 1280px.

Checkout pairs flexible form content with a 300px trip summary at 1024px. On smaller screens the summary follows the form with a top divider. Wrapping, shrinkable grid tracks, and breakable route/reference text support the verified 320px viewport without horizontal page scrolling.

## Elevation & Depth

Result cards, facets, and checkout are flat, border-defined tonal surfaces. Card hover changes the border toward gold rather than lifting the card. Shared select popovers use ambient shadow and blurred translucent containment; this is temporary overlay depth, not the resting card treatment.

## Shapes

Main panels use the inherited React Bits surface radius, bound to the public 1rem application radius. Buttons use the shared control radius, selects the field radius, and inputs the input radius. Fine borders and separators define containment. Progress is a slim rounded track; route suggestions are text-first rows with a bottom divider.

## Components

- **Search:** dark fields inside the gold rail; dependent destination choices and the available reverse route determine enabled states. The dark search action completes the rail.
- **Buttons and fields:** explicit search, selection, and checkout controls are 44px tall. Shared controls preserve gold focus rings, reduced opacity while disabled, and a one-pixel pressed response. Inputs keep visible labels; validation and service failures remain readable inline alerts.
- **Trip cards and facets:** licensed Filtering8 adapted to real bus inventory, with departure/duration sliders, result count, reset, and sorting. Price is per passenger; group totals and payment context stay textual.
- **Checkout:** licensed Wizard2 adapted to passenger data, review, and confirmation. Named steps accompany numeric progress. The next action changes with the step; consent enables final submission, and busy state disables repeated action. The adjacent trip summary retains dates, timezone, seats, total, and cash-on-boarding context.
- **Navigation and receipt:** the supplied mark anchors the booking header; the team login remains a separate utility link. Confirmation presents a selectable reference and print action. Printing removes navigation, progress, and action chrome, and uses white paper with dark text.
- **Loading and absence:** skeletons accompany busy states; no inventory produces a clear recovery message rather than demonstration cards.

## Do's and Don'ts

### Do:

- Do keep route, time, date range, timezone, and payment context readable as text.
- Do preserve the facet disclosure and stacked checkout summary on small screens.
- Do keep task actions and search fields at their established 44px height.
- Do respect reduced motion: result entry is motion-safe and progress transitions stop when requested.

### Don't:

- Don't spread the gold search treatment across result or checkout cards.
- Don't replace mobile inventory with a horizontally scrolling desktop table.
- Don't let color alone communicate selection, progress, validation, or payment state.

Not canonized: compact inherited utility buttons/select defaults are implementation details, not a public touch-target rule; one-off receipt decoration and error values are not reusable tokens.
