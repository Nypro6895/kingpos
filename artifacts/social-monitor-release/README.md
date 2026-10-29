# Social monitor-only release

Owner request: social spam/bot detection should inform admin rather than automatically block posting, comments, replies or image publishing.

The migration makes social quotas advisory, ignores automatic restrictions for social actions, logs deduplicated BotID/volume signals in Admin > Post safety > Spam > Recent activity, and records repeated content/images without hiding new content. Keyword matches create admin review cases without changing publication. Explicit human restrictions, suspension, signed context, RLS, authentication and existing moderation holds stay enforced. Old held content is not mass-published. Login/signup/recovery controls are preserved from the actual current production definitions, including signup retry accounting and account-erasure trigger exceptions.

Web changes tolerate BotID outages and advisory signal-write failures. Already-saved comment requests recover before preflight only when author, acting identity, body, target and parent match.

Combined scope: verified Payroll panel removal on web, and a native build from uploaded build62 source with only that Payroll view delta. No changes to Payroll calculations or source data.

Other queue entries were inventoried in queue-audit.json: incomplete Market/Check Writer provider/acceptance gates, independent tools/reports and historical diverged snapshots are not blindly overlaid onto the newer shipped source.

Validation: focused SQL/runtime tests, scoped ESLint (two pre-existing Payroll warnings), fresh production Next build/typecheck and offline assets. A hash-bound SQL wrapper checks all seven production function fingerprints and records the migration atomically. Physical iPhone posting with a real customer account is separate from local SQL/runtime evidence; no public test post, email, SMS or financial transaction is created for verification.
