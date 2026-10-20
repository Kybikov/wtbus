<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Editing existing data

Use blur-based autosave for existing records and settings throughout the product. Text and number fields commit when focus leaves the field; completed selects, switches and uploads commit immediately. Use the serialized field queue described in `docs/interface-settings.md`. Preserve newer drafts, report failed writes and never abort a previous mutation to replace it. New-record creation, deletion, credential confirmation and financial actions remain explicit. Do not add Save buttons to ordinary updates.


Saved-view configuration is an explicit exception: filters, sorting, columns, card layout and board ordering are preview drafts. Show the centered unsaved-view banner and persist only after the user chooses Save current or Create new. View name and visibility remain ordinary blur/choice autosaves. Keep record mutations, including Kanban status changes, separate from these layout drafts.

## Unavailable actions

Every disabled action must explain the actual reason and, where possible, how to enable it. Pass `disabledReason` to shared buttons, hold confirmations and menu items; native action buttons use `data-disabled-reason`. Cover every branch of a compound disabled condition. Keep hover, keyboard focus and touch explanations available without changing layout or removing activation, permission or financial safeguards. Loading and saving explain the pending operation; read-only and unavailable states explain their restriction. Do not use a generic “unavailable” message in place of a known reason. Settings may inherit a precise loading/error/subscription reason from their disabled scope. The disabled-action contract test checks new call sites.
