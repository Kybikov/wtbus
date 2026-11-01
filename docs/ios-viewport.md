# iPhone viewport and keyboard

The application has one viewport owner, `useAppViewport`, mounted by the stable
mobile navigation provider. Pages and the dock must not independently measure or
write viewport geometry.

## Evidence and scope

- [OpenChamber issue 2287](https://github.com/openchamber/openchamber/issues/2287)
  and [merged fix 3593](https://github.com/openchamber/openchamber/pull/3593)
  describe the installed-iOS bottom band caused by percentage root heights.
  Large viewport sizing is scoped to installed iOS, not browser tabs or Android.
- [WebKit 313800](https://bugs.webkit.org/show_bug.cgi?id=313800) records a
  status-bar-sized deficit in both innerHeight and visualViewport on cold start.
- [WebKit 217754](https://bugs.webkit.org/show_bug.cgi?id=217754) records bottom
  safe-area padding remaining while the keyboard is visible.
- [Apple forum 800125](https://developer.apple.com/forums/thread/800125) records
  stale visual geometry after keyboard dismissal.
- [WebKit 317153](https://bugs.webkit.org/show_bug.cgi?id=317153), comment 2,
  advises removing the deprecated black-translucent status-bar metadata.
- [Piclaw's device notes](https://github.com/rcarmo/piclaw/blob/main/docs/PWA.md)
  document fixed-root clipping and root-scroll recovery on current iOS versions.

These reports explain several related WebKit failures; they do not prove which
iOS version or installation state an individual user has.

## Invariants

1. Staff html/body stay in normal document flow. Explicit height replaces fixed
   roots and percentage height chains. Body height also survives Base UI's modal
   scroll lock, which otherwise writes 100dvh inline.
2. Browser tabs and Android retain dynamic layout height. Only installed iOS uses
   measured 100lvh; matchMedia and navigator.standalone both detect installation.
   Never assign screen.height to regular browser tabs or add an unmeasured notch
   correction.
3. Installed-iOS dock and portal layers anchor to the same document rectangle,
   instead of a shortened fixed-position containing block.
4. Layout and visual rectangles are separate. A focused input plus substantial
   occlusion indicates a software keyboard. Small stale offsets after dismissal
   do not shrink the idle application. Android may resize innerHeight itself.
5. Bottom safe area is zero while the keyboard is visible. The full-width blurred
   dock consumes the home-indicator inset once, below the rounded navigation bar.
   The bar keeps equal top/bottom padding; safe area must never stretch its pill.
   Dialogs, drawers, search and footer clearance consume the same shared values.
6. Focus recovery resets only document scrolling on iOS, never the application's
   inner record/dialog scroll areas. Pinch zoom remains browser-controlled. RAF,
   focus recovery timers, probes and listeners are removed on cleanup.

## Verification

Run `node --experimental-strip-types --test tests/mobile-viewport.test.mjs`.
The cases cover measured iPhone cold-start deficits, browser toolbar sizing,
keyboard open/close, Android resize, hardware keyboards, rotation and pinch zoom.

Desktop responsive checks cannot reproduce an actual WebKit compositor bug.
On a physical iPhone verify a cold PWA launch, background/foreground, portrait
and landscape, then open/close the employee keyboard, role popup, drawer and
search. The body, dock background and overlay must reach the same bottom edge;
buttons must remain outside the home-indicator touch area. Repeat in a Safari
tab and Android: browser toolbars must not be covered. Installed iOS can retain
launch metadata from installation; reload first, and investigate installation
state only if the physical-device result still differs.
