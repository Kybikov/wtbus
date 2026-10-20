# Editing and appearance

Existing operational records and settings save when a text/number field loses focus. Selects, switches, uploaded logos and other completed choices save immediately; the colour picker commits when closed. Do not add a Save button to normal updates. New records/views/statuses, deletions, credential reauthentication and money movements remain explicit actions.

Use `useFieldAutosave` with `createAutosaveQueue`: initialize only from a successful load, commit only the field the user has finished, serialize writes, and merge against the last acknowledged server value. Never abort one mutation to replace it with another. Keep newer drafts on screen when an earlier response arrives. Unchanged blur performs no request. Errors retain the draft and show an error toast; leaving the corrected field retries it. Do not allow edits until initial data loads successfully. Server validation and permissions still apply.

Shared light-theme tokens use warm off-white surfaces, darker secondary text and distinct controls/borders. Status tones must provide separate light/dark text colours. Use shared control/popover/card tokens instead of hard-coded white backgrounds or a dark-only foreground.

Neutral buttons, inputs, selects and search use `--control` and `--control-hover`: a raised grey-olive surface in dark mode and a soft warm grey in light mode. Primary and destructive actions retain their semantic colours. Do not override ordinary controls with `bg-background`.

The standard personal appearance is dark, company accent, comfortable density, large radius, medium scale, floating sidebar and full sidebar mode. `defaultInterfacePreferences` shares the frontend defaults; the API defaults and migration 41 match them. The personalization page's “По умолчанию” action restores this set and saves it through the existing preference flow. Saved personal choices are preserved when the application is updated; migration 41 changes only defaults for new database rows.

## Automatic exchange rates

The API currency worker starts independently of HTTP readiness and refreshes public Monobank quotes every five minutes. No payment token is needed for public quotes. Fresh data and a separate last-good snapshot are shared in Redis. Reading settings does not wait for an external bank request. During outages, last-good quotes are labelled and saved report rates remain unchanged; quotes older than seven days are rejected.

Settings display one EUR/USD/PLN in **UAH**, retaining the provider's buy and sell sides and each quote's timestamp. Cross-only currencies show a separate calculation rate, never an invented spread. The worker atomically saves the arithmetic midpoint (or cross rate) normalized to each company's existing reporting base. It never changes the reporting base, payment amounts, booking snapshots or historical transaction currencies. Unsupported currency rates are not invented or removed. Unchanged rates are not rewritten.

Verification: `npm test`, typecheck, changed-scope ESLint, production build, `go test ./...` with an isolated `NOTIFICATION_TEST_DATABASE_URL`, and `go vet ./...`. Browser checks cover blur vs typing, unchanged blur, reload persistence, notification switches, field/status/view editors, error recovery, and light/dark layouts at desktop and 320/390 px.

## React Bits Micro controls

Use the shared DeliverySwitch (Squish Switch) for boolean settings, shared Select (Glide Select) for choices, and HoldActionButton for destructive confirmations. Source is adapted from the current React Bits TS/Tailwind registry. Switch drags commit once on release; cancelled gestures do not save. Selects preserve Base UI portals, collision handling, scrolling, typeahead and disabled options. Hold confirmations require 1.2 seconds with pointer or keyboard; early release, focus loss, pointer cancellation or Escape cancels. Motion respects reduced-motion preferences. Row selection and passenger consent remain checkboxes.


Saved-view configuration is the explicit exception to automatic saving: columns, filters, sorting, metrics and card/board layout remain preview drafts until Save current or Create new is chosen in the centered bottom banner. Name and sharing changes still autosave. Kanban status transitions remain immediate operational changes; only their card order belongs to the layout draft.
