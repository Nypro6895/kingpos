# CompactFilters on the declared iOS 16 minimum

The shared filter panel called `hidePopover()` during mount without checking
whether the browser implemented Popover. Safari added that API in 17; the iOS
project still supports 16. An isolated fixture importing the actual component
reproduced `panel.current?.hidePopover is not a function` with Popover methods
absent. That fixture is a capability simulation in Chromium, not a physical
iOS 16 test.

CompactFilters now uses the existing native Popover branch when both methods
are available. On older browsers it uses an in-place modal dialog, retaining
the same controls, CSS, coordinates, and original native form association.
Dialog is available from Safari 15.4. No portal, polyfill, dependency, permission,
or minimum OS change was introduced. The SSR capability snapshot starts closed
and hidden, and the client selects its supported branch with useSyncExternalStore.

The fallback backdrop is transparent. Its modal focus containment and inert
background differ from modern nonmodal Popover; Escape, the existing close
button, and clicking outside the panel dismiss it. Closing never clears draft
controls. Route, access/scope reset, and React Activity hiding also close the
panel while preserving retained children. A stale queued dialog close event is
ignored after the dialog has reopened.

Submits that bubble past the owning guards close the panel, including accepted
JavaScript navigation that prevents document submission or reuses the same
query. The outer-form listener admits only the original form and panel-owned
submitter or focused control. Captured offline guards and stopPropagation
guards retain their submission ownership and draft. There is no global form
interceptor or replacement submitter.

In the synthetic Admin-style outer form, Enter in its panel input selected the
browser's first default submit button outside the panel in both capability
branches. Its original name/value and all successful controls were preserved;
no Apply button was invented. Modern Popover focus/dismissal varied between
observations, so this is recorded as browser behavior rather than a new
submission contract. Visible in-panel Apply consistently closes both branches
and retains its own exact submitter. Safari 16 behavior still needs device QA.

Verification imports the actual component and real CSS into a loopback-only
fixture with only Next router context replaced. It covers modern and missing-API
branches, identical panel geometry/style, clipping escape, retained DOM/values,
same-query inner/outer forms, guard ownership, focus/Escape/outside dismissal,
route/scope/Activity cleanup, and rapid reopen. Existing Search, Help-return,
and installed read-only filter suites remain separate regression evidence.
This does not establish hosted, provider, or physical-device acceptance.

References:

- [Apple Safari 17 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes)
- [WebKit: Introducing the Dialog Element](https://webkit.org/blog/12209/introducing-the-dialog-element/)
- [WebKit: Safari 15.4 features](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
