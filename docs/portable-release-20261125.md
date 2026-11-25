# Portable POS release — November25,2026

Web/iPad is live at https://reylumi.com/pos/portable. Employee and Customer roles retain the existing login and display designs. Phone/profile entry now reaches greeting/service selection and check-in confirmation; standalone check-in survives an idle-cart change or transport reconnect. Receipt/tip validation and persistent customer enrollment remain scoped to the salon workstation.

- Web deployment: `dpl_HMeF5o5FLLbNsWFTri8zBLtwMibc`, source `6828cd12ea38fc7b35131b7e584e0fa3ef5e6620`; exact4,351provider content files verified. Publication event `570fe300-b8d2-4743-97f4-fba87024f94b`.
- Windows download remains0.7.6 at https://reylumi.com/download/windows. No installer changes. Existing installed-code storage/restart/queued-receipt isolation and server/download compatibility checks passed with isolated profiles.
- iOS1.0.1(104), source `074a4e33413b3aaa8253426ba1e306e800fde977`, is VALID and available in both pre-existing internal TestFlight groups. Publication event `c6d50829-81eb-4825-93e8-0c6849d72dc4`. Owner iPhone POS is preserved; the native update includes Portable and the previously authorized Print Check disable. No App Store submission/publication or tester invitations were performed.

Verification:87local web regressions, production build/TypeScript/ESLint, exact current production baseline and deployed source, candidate and public-live desktop/iPad role checks. Native input99local checks passed; actual iPhone CI passed280/280 and verified the signed archive/upload. GET-only Apple availability confirms both existing groups. Independent asset/source checks cover370bundle files and79changed product-source pins.

The initial full iPad CI run83 exceeded its budget without useful logs; its counts are unknown and not accepted. Completed iPad validation on the established Mac used the exact104source/package with a fresh isolated iPad Simulator:280/280,0fail/skip,16/16hosts, unsigned archive and allsource/package hashes passed. The unchanged recipe used Xcode27.1/iPadOS27.0; signed104was produced with CI Xcode26.3. These are source/package/Simulator checks, not byte-identical local signed-binary or physical-device acceptance. The owned Simulator was shut down; prior profiles, source23/build105 roots and real app data were preserved.

No production financial transaction, real staff login or guest pairing was submitted during public live QA. Authenticated provider Realtime, physical two-device/printer behavior and physical-device installation remain separate acceptance scopes. Broader Store source23, policy web delivery, membership, privacy/reviewer and Organization/DUNS gates remain retained; this scoped release does not mark those completed.

Full evidence and before/after coordinator guards: `C:/Reylumi-worktrees/portable-release-20261125-r1/artifacts/portable-release-20261125/REPORT.md`.
