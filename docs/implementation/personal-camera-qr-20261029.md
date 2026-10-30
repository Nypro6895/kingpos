# Personal Camera QR check-in — integration handoff

User decision: scan a salon QR with the iPhone system Camera; installed Reylumi opens the salon check-in; sign-in/signup must return to that entry. Basic customer account check-in is independent of advanced paid Staff Scan.

## Implemented candidate
- Native HTTPS Universal Links and explicit web Open Reylumi fallback, restricted to exact trusted origins/UUID entry paths. No account/role/token claims accepted from a link. No automatic check-in write.
- Associated Domains entitlement and public JSON AASA endpoint, limited to /check-in/*; public OS document skips session refresh/device cookies. Team/application identifier must still be checked against the actual signed archive/profile.
- Separate basic paired-display entry, catalog and name-only landing RPCs. Personal check-in removes only its advanced feature gate; preserves all installed account, identity consolidation, retry/visit/service/financial guards. Advanced relay and Staff Scan stay gated. Paid receipt behavior is unchanged.
- Landing retains the original entry for Open app and web login/signup continuation. It reads only salon name; catalog loads at the actual check-in screen. Native startup uses a known incoming QR as its initial route instead of scheduling a second home navigation. Cold-delivery timing still requires physical acceptance.
- Install URL is server-only REYLUMI_CUSTOMER_IOS_INSTALL_URL, HTTPS apps.apple.com or testflight.apple.com only. No public URL is configured or invented. Smart App Banner is enabled only for a configured App Store URL, not a TestFlight URL.

## Important distribution limits
Numeric Apple app ID6821394475, bundle com.reylumi.ios, Team WJ4VQ4529Z are verified by release coordinator from release72 Apple evidence. Current verified distribution is invited TestFlight groups only; not public App Store. Apple public lookup for app6821394475/countryUS at2026-10-30T04:20:05Z returned HTTP200/resultCount0 (not a claim about every storefront). Without a verified public install URL the landing states tester availability and offers working website check-in.

Universal Links do not establish guaranteed deferred handoff through a fresh App Store installation. Explicit supported journey: install → return to the original QR page → Open Reylumi → login/signup → same entry. Do not promise automatic recovery after a fresh install or use device fingerprinting/clipboard permission for it.

## Validation and release gates
- Isolated full-schema DB basic unpaid-salon case passes, including inactive services, inactive salon, expired/closed display, anon denial, other account read denial, request retry and active-visit reuse. No paid receipt or advanced gate enabled.
- Landing SSR behavior tests and existing Personal QR UI behavior test pass. Source-only scoped TypeScript and server-module bundle checks pass.
- Mac simulator build-for-testing succeeds; final NavigationPolicy XCTest suite9 tests passes with0 failures. No physical product installation performed. Simulator task environment is separate; its device is shutdown.
- Baseline correction: native72 source9196c703 predates hosted web0d3617c by exactly the shipped financial-retention migration and canonical test helper. Initial isolated runs omitted that hosted migration and therefore exposed the already fixed Staff-delete FK issue. Candidate branch was fast-forwarded to exact hosted0d3617c, preserving all native source and QR edits; no new Payroll fix or permission change is part of this scope. Final sequential run on the complete hosted schema plus the basic QR migration passes18/18 tests with0 failures,335 migrations. Earlier parallel fixtures removed only their own labelled containers, but one cleanup assertion incorrectly counted the other naturally completed test as a missing prior container; final runs are sequential.
- Production build, actual hosted migration, signed Associated Domains/profile verification, AASA live no-redirect/JSON/CDN verification, real Camera cold/warm opening and login/signup continuation remain pending integration/release acceptance.

## Required integration order
1. Integrate selected files against the exact current live/native source; preserve all other queued scopes. Customer Display fallback ef674f7 is separately queued and compatible.
2. Apply migration20261030041000 only after validation; publish corresponding server actions/API/landing/AASA together. Otherwise the display cannot issue a basic entry.
3. Rebuild source-bound native bundle, generate Xcode project, verify provisioning includes Associated Domains and signed application-identifier matches AASA, sign/archive/upload through existing authorized coordinator. A web-only deployment cannot add Universal Links to binary72.
4. Verify release availability, update device, then system Camera scan in cold/warm and signed-in/out states; explicitly confirm check-in, repeat-scan once, check Owner waiting/POS and customer history. Do not use simulator/source checks as physical acceptance.
5. Verify a public customer install channel before setting the install URL. Fresh-install test requires a spare device/appropriate install channel; don't uninstall the primary authenticated audit device implicitly.

No hosted database mutation, web deployment, App Store/TestFlight publication, new tester invitation or actual payment was performed by this change.

Audit72 continues separately at C:/Reylumi-worktrees/personal-audit-fixes-20261029/artifacts/full-audit72-20261029/WORKING-AUDIT.md. Controller05 stopped and device lease returned to the release coordinator. QA ticket T00043 remains open/unpaid25 due a separately reported cancellation guard failure; booking itself was cancelled.

Apple references:
https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content
https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners
https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links
