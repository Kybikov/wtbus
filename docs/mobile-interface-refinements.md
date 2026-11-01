# Mobile interface refinements

This update adapts the licensed React Bits Pro Mobile 5 Sorbet and Download 6 sources to the existing shared controls. Mobile 5 was supplied by the user; Download 6 was fetched from the licensed registry. The license remains in the ignored local environment file.

## Records and navigation

- Mobile table/list views use compact independent rows. Gallery remains a separate view. A hold selects a row; movement cancels the hold so ordinary scrolling remains available. Keyboard Space and the opposite-side swipe action offer the same selection flow.
- Selection actions occupy a footer row, including Select all. Unsaved-view controls occupy another row above the metrics; neither overlays metrics. Ordinary record changes remain separate from view drafts.
- Mobile Kanban uses shared status tabs and full-width snap columns. Native horizontal panning changes the visible column; the selected tab follows the scroll position. Existing workflow validation and confirmations remain in place.
- The full-screen main menu follows Mobile 5, with expandable overview/settings sections, the plain booking-page link and a profile footer. Dock configuration is a dialog with the existing accessible reorder list and a separate list of available pages.
- Details, relations and activity share a compact tabbed panel. Supported fields remain directly editable; text and numbers save on blur, completed choices save immediately through the serialized queue. Relation selectors have separate navigation buttons. Route-derived cities explain their restriction. Developer can edit trip details regardless of workflow status; other roles retain the existing restriction.
- A fixed-size save indicator prevents a blur-triggered save from moving the tabs under the pointer. Failed writes keep drafts and show an error; correcting and blurring retries the write.
- Password fields have independent show/hide controls. Settings rows use labels and controls without nested cards. Credential changes still require explicit submission.

## Record numbers

Migration 46 adds a tenant/entity counter and a separate number registry for customers, bookings, trips, routes, vehicles, team memberships, requests and availability. It deterministically backfills existing rows without changing UUIDs or relationships. Insert/delete triggers cover creation paths outside the HTTP API, including imports and bots.

Defaults include `TR-00001`, `BK-00001` and `VH-00001`. Managers and developer can set the prefix, suffix and minimum digit count at `/settings/numbering`. Completed fields autosave. Formatting changes apply to future records only. Allocation locks the counter row, retries formatted collisions, does not truncate large values and rolls back with the creating transaction. Removed numbers are not recycled.

Details show the short number with a copy action. Desktop and mobile global search accept the formatted number or its numeric sequence. Results stay within the session tenant; team results remain restricted to management and developer. UUID-based links and existing integrations continue to work.

## Scale, safe areas and installation

Migration 47 extends the existing scale settings to 75%, 87.5%, 100%, 112.5% and 125%. Existing S/M/L values retain their meanings. The shared slider is available in personalization and from the mobile account header. Preferences use serialized writes with visible write errors; an earlier mutation is not aborted when another choice is made. Mobile controls now follow the root scale instead of forcing the root back to 16 px. Public booking pages retain their own scale.

Notifications use shared pill tabs and the shared primary action. The account header shows the current theme as a moon or sun. The mobile dock has a blurred surface extending through the bottom safe area, with an 8 px minimum inset at standard scale. Header/close controls account for the top safe area. The open create button follows the same measured dock padding, and the action list explicitly overrides the global scrollbar rule.

Download 6 supplies the split hero/platform-list layout for `/profile/app`. It offers macOS, Windows, Android and iOS. A supported current-device action uses the real single-use browser install event; other cases open platform instructions. It does not advertise native packages, stores, invented versions or download sizes. Instructions link to [Apple](https://support.apple.com/104996), [Google Chrome](https://support.google.com/chrome/answer/9658361) and [Microsoft Edge](https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge).

## Verification

- 105 frontend tests pass, including scale-cookie persistence, platform detection, single-use PWA install events and the disabled-action contract.
- TypeScript, changed-scope ESLint, production build and `git diff --check` pass.
- `go test ./...` and `go vet ./...` pass. Record-number and entity-view/detail database tests ran against disposable local PostgreSQL. Other optional database suites were not enabled. Number tests exercise migration/backfill/downgrade, concurrent allocation, format persistence, rollback, collision handling, tenant isolation, permissions and all scale values.
- Local browser checks used a separate API fixture and fake identities. No production business records were changed. Checks covered blur/error recovery, detail tabs, password visibility, number lookup, prefix reload persistence, dock reordering, selection/metrics separation, Kanban tabs, the full menu, PWA instructions and light/dark themes.
- At a measured CSS viewport width of 312 px, document width stayed 312 px. Scale endpoints produced 12/20 px root fonts and 36/60 px create buttons; the 75% setting survived reload. Kanban columns matched the 280 px content rail. The unsaved banner ended at 505.6 px and metrics began at 513.6 px. The create list reports `scrollbar-width: none`; open/closed create-button positions differed only by subpixel rounding.

Physical iOS safe-area rendering, native touch holds/swipes and OS-level PWA installation still need device acceptance; browser checks and synthetic install-event tests do not replace it. The local preview remains available for review. The user authorized commit/push after the final checks.

## Mobile navigation follow-up

The full main menu again includes section icons and the company mark. The account role aligns with the close control; dock configuration stays in a separate bottom footer. Page actions, including the current-page create button, appear immediately before the mobile account trigger. Empty page-control headings are omitted.

The mobile list exposes the shared card-layout editor, including in the default table mode. Its field changes remain view drafts until explicitly saved. The Select heading is removed. Shared React Bits Swipe Row owns both the hold timer and drag capture: holding selects, movement cancels the hold, and hold/drag completion suppresses the following navigation click. Left swipes reveal record actions; right swipes reveal selection. Full-swipe execution is disabled, preserving explicit destructive and financial confirmations.

Mobile Sonner banners enter below the topbar and top safe area, with upward and sideways dismissal plus a close button. Desktop positioning remains bottom-right. HTML/JSON parser failures become a concise retry message; actual business restrictions remain visible. Details use a static query endpoint with server-side collection/identifier validation and the existing authenticated tenant-aware forwarding. Explicit customer and booking pages share the same detail component. Initial load failures render Retry and Back to list instead of an empty detail panel. This handles malformed responses but does not establish the cause of the production HTML response in the screenshot.

Follow-up checks: 108 frontend tests, scoped ESLint, TypeScript and production build pass. Local fixture browser checks cover icons, the pinned footer, a 401 px document without horizontal overflow, page create placement, configurable list-field preview and cancellation, keyboard selection, customer/booking/trip details, HTML-response failure and successful retry, top toast placement and close-button dismissal. Native touch holds, two-direction swipes and iPhone safe areas still require physical-device acceptance. No production records were changed.

## Detail reads before numbering rollout

Record details no longer require the numbering registry to exist. If the enriched query fails with PostgreSQL `42P01` and a separate schema check confirms that `record_numbers` is absent, the handler reads the original tenant-scoped record projection. It logs the missing migration and omits the short number. It does not generate replacement numbers, apply migrations from a request, relax permissions or suppress unrelated database failures. Once migration 46 is present, the next request includes the assigned number without restarting the API.

`TestEntityDetailsBeforeNumberingMigrationPostgres` verifies this against isolated PostgreSQL, including recovery, cross-tenant denial, driver denial, missing-record 404s and failure when a business table is missing. The existing privacy/relation tests pass for all eight collections. Production details and numbering endpoints were failing together; production schema state still requires server-log confirmation.
