# Production GO execution evidence — 2026-08-31

## Decision

- Formal orchestration status: `BLOCKED_EXTERNAL_PROVIDER`
- Production runtime status: deployed and operational on Netlify Free
- Production GO label: not declared, because five of the 22 exact requested models did not produce a valid runtime response
- Remaining user action: none

All application, database, administrator, scheduler, Outbox, rollback, production, and backup gates were executed. The only open mandatory gate is the exact 22-model runtime requirement. Provider failure is not relabeled as a successful model run.

## Release identity before this evidence-only commit

- Canonical repository: `/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation`
- Branch and remote: `main` / `origin/main`
- Release merge SHA: `10372b57e8e1ebc06b456139946cb25f37a0220b`
- PR #2 merge SHA: `93185ec7e28a475903eb001e425c81249dd92b93`
- PR #3 merge SHA: `10372b57e8e1ebc06b456139946cb25f37a0220b`
- Main Reservation Hardening run: `33348454885`, success on the release merge SHA
- Main Security Checks run: `33348454883`, success on the release merge SHA
- Production deploy ID: `6a94dc448e4a2000088368dd`
- Production deploy commit: `10372b57e8e1ebc06b456139946cb25f37a0220b`
- Production URL: <https://bistro-centquatre-104.netlify.app>

An evidence-only commit may follow this record. Its final merge SHA, CI SHA, production deploy SHA, and workspace-bundle HEAD must be checked again after merge; application code remains the release merge above.

## Application and database changes

- Supabase recovery links establish an authenticated recovery session before entering the password-reset page and scrub recovery material from the browser URL.
- The intended administrator completed password setup, TOTP enrollment, ADMIN provisioning, and AAL2-protected access to `/admin/reservations`.
- Supabase Site URL and six callback/recovery redirect URLs point to the Netlify production and Preview origins.
- Migration `20260831014000_allow_runtime_operational_audit_writes` grants only the required runtime `SELECT`, `INSERT`, and `UPDATE` policies for `SchedulerHeartbeat` and `OutboxDrainAuditLog`.
- No runtime `DELETE`, `TRUNCATE`, or broad `ALL` grant was added.
- Production migration application completed with 27 migrations present.

## CI and production deployment

- PR #3 Reservation Hardening run `33348278791`: success, including test-database migration, full tests, database tests, security checks, and production build.
- PR #3 Security Checks run `33348278626`: success.
- Final main Reservation Hardening run `33348454885`: success.
- Final main Security Checks run `33348454883`: success.
- Netlify Production deploy `6a94dc448e4a2000088368dd`: `ready`, plugin `success`, Node.js 22, exact release merge SHA.
- Scheduled function `outbox-failsafe`: deployed with `23 18 * * *`; next execution is displayed in JST by Netlify.
- GitHub `CRON_SECRET` and Netlify Production `CRON_SECRET` were synchronized without printing the value. The backup encryption key was not changed.

## Public production checks

| Route | Result | SHA-256 or boundary evidence |
| --- | --- | --- |
| `/` | HTTP 200 | `ac44f7b760ee049a95860f319e376aff7e75e68513ee64a0d6b583375b210edf` |
| `/booking` | HTTP 200 | `61d559246264759e17d1ee945dfd173979ff2f3fb70785397ca771f601b763a9` |
| `/robots.txt` | HTTP 200 | `a37ad108251e7d327528b9401711107500f1331b3dd8c03349fb51af417134f4` |
| `/sitemap.xml` | HTTP 200 | `1034f5ba53ed8a6c109c40ec1a1ab568975aecf9427535c8305af1636e277979` |
| unauthenticated `/admin/reservations` | HTTP 307 | redirects to `/admin/login?error=unauthorized` |
| unauthenticated `/api/admin/outbox/status` | HTTP 401 | `Cache-Control: private, no-store` |

- Daily lunch, monthly lunch, and monthly dinner availability calls: HTTP 200.
- Twenty parallel monthly availability calls: 20/20 HTTP 200.
- No real customer reservation, email, or LINE message was created for the canary.

## Scheduler, Outbox, and failsafe

- GitHub workflow dispatch `33348816911` ran on `10372b57e8e1ebc06b456139946cb25f37a0220b` after the rollback/re-promotion exercise and completed successfully.
- Both reservation-email and order-notification lanes returned valid success payloads with empty backlog.
- Production heartbeats were persisted for `RESERVATION_EMAIL` and `ORDER_NOTIFICATION`; the last checked GitHub run had no failure or error and zero retry/dead-letter/backlog counts.
- Reservation email Outbox: zero pending rows at the check.
- Order notification Outbox: zero pending rows at the check.
- LINE notification events: eight rows observed, all `SENT`, with no duplicate-send evidence.
- Netlify `Run now` executed `outbox-failsafe`; the function log reported `succeededLanes: 3`, `failedLanes: 0` for `RESERVATION_EMAIL`, `ORDER_NOTIFICATION`, and `LINE_REMINDER`.
- Destructive daily maintenance was intentionally not dispatched because it can cancel expired orders and delete histories; that workflow is outside the no-destructive-data verification scope.

## Rollback and re-promotion exercise

1. Production was restored to ready deploy `6a94d994eb01f771992261ac`, commit `93185ec7e28a475903eb001e425c81249dd92b93`.
2. The restored public `/` and `/booking` routes both returned HTTP 200.
3. Production was restored to deploy `6a94dc448e4a2000088368dd`, commit `10372b57e8e1ebc06b456139946cb25f37a0220b`.
4. The final public routes and auth boundaries passed again.
5. GitHub Outbox workflow `33348816911` passed after re-promotion.

## Vercel retirement

- The Vercel project `bistro-centquatre-104` was disconnected from `miyamibu/bistro-centquatre-104`, so future repository pushes no longer create Vercel deployments.
- Removed Bistro aliases:
  - `bistro-centquatre-104.vercel.app`
  - `bistro-centquatre-104-miyamibus-projects.vercel.app`
  - `bistro-centquatre-104-git-main-miyamibus-projects.vercel.app`
- All three removed aliases returned HTTP 404 after removal.
- The separate `french-restaurant-site.vercel.app` name was not removed because it belongs to a separately named project and was not safely in scope for Bistro retirement.

## Backup lanes

### Lane A — reservation export

- Existing Keychain service/account only: `bistro-production-backup-encryption-keyring` / `backup-encryption-keyring-json`.
- Active key ID: `v1`.
- Key creation, rotation, overwrite, or plaintext output: not performed.
- Latest pull: `2026-08-31T02:02:59.014Z`.
- Freshness: `FRESH`, age 0.02 hours at check, maximum 26 hours.
- Coverage: 2026-08-01 through 2026-10-30 in four chunks.
- Encrypted daily files: 91/91 integrity verified.
- Encryption: `bistro-reservation-backup-aead`, version 2, AES-256-GCM, key ID `v1`.
- Permissions: backup directory 700; run metadata and encrypted files 600.
- Latest-run SHA-256: `4306a9bcfcedeaafdd98596e9b9984016aeede416d8fd890eec9ba3aefa4d568`.
- Current export totals: 52 reservations and 14 business days. These are operational counts, not public customer data.

### Lane B — workspace bundle

- File: `backups/workspace-snapshots/latest.bundle`
- Release HEAD: `10372b57e8e1ebc06b456139946cb25f37a0220b`
- Bundle SHA-256: `ce3bde09e24653b96207266ffaa8e62faf557aa03b7e4bff29b1103973483637`
- Size: 192,632,840 bytes.
- Permissions: bundle and provenance 600.
- `git bundle verify`: complete history, five intended refs, success.
- `backup:workspace:status --expected-head=10372...`: success.

### Lane C — restore/validation

- Retained encrypted files checked: 96.
- Successful authenticated decryptions: 96.
- Schema/checksum dry-run validations: 96.
- Observed key ID: only `v1`.
- Failures: zero.
- Database writes: not performed; the drill reports `NOT_SUPPORTED`.

## 22-model execution ledger

- Ledger run: `20260829T190401+0900`.
- Sanitized target SHA: `ede6861310e6750df64994da1a47bd8683170868`.
- Exact zero-price catalog entries: 22/22.
- Runtime responses accepted by the probe transport: 17/22.
- Exact models unavailable after bounded retry: 5/22.
- Worker file changes: zero.
- B.AI privacy terms remained unknown, so only a public non-secret probe was sent.
- Kilo reported consent/training handling; only approved non-sensitive probes were sent.
- OpenCode registry allowed public non-secret probes.

| Lane | Provider | Display name | Exact model ID | Probe | Session/request ID | Raw output SHA-256 | Work/adoption | Constraint result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B01 | B.AI | DeepSeek-V4-Flash | `deepseek-v4-flash` | MODEL_UNAVAILABLE | — | `9b5789b28a7b6c81ffe8548d4ad4a05fad966dc9292beee38c50672544070240` | not adopted | response model mismatch |
| B02 | B.AI | GLM-5.3-Flash | `glm-5.3-flash` | PASS | `ae643cb8-b23f-4c00-88f5-078a14e8b9fc` | `85f6a3fd84ed8daf1d2b529545c44096ed783c273a751df3dc305a1cc6b240d2` | capability evidence | none |
| B03 | B.AI | Hy3 | `hy3` | PASS | `4639f04f-e90b-4201-9e39-591d10c9d2c8` | `96dd3186a83be8544cd28e1c2c9fb04c3736edfb34f8eaf8333f11a884323959` | hypothesis reviewed; parent evidence governs | none |
| B04 | B.AI | MiMo-V2.5 | `mimo-v2.5` | MODEL_UNAVAILABLE | — | `35fea7c91a4cc18d17335ed39810986e7b903b49b3167aebb82612b9e58988c7` | not adopted | rate limited |
| B05 | B.AI | Qwen3.8-Flash | `qwen3.8-flash` | PASS | `23174344-df7a-4516-ba44-02860d7c6fd5` | `e2858c54cfd3d1b1b000755176de28ca3c767869f58432abc97bd4cc6a8ae870` | formal smoke only | no file-work proof |
| K01 | Kilo | Cohere North Mini Code | `cohere/north-mini-code:free` | MODEL_UNAVAILABLE | — | `c798118e2bb4fe25319fe1b1e6e42148b0f785111298d5f3d613b89adf9acaac` | not adopted | missing response content |
| K02 | Kilo | Dots3-Note Preview | `dots-studio/dots-3-note-preview:free` | MODEL_UNAVAILABLE | — | `88c92e19c88d036bd2fd429cce9b18c849a38e2138e3b34e3bc2b1662b72a747` | not adopted | missing response content |
| K03 | Kilo | Ling 3.0 Flash Fin | `inclusionai/ling-3.0-flash-fin:free` | PASS | `4d77cf5f-6c11-4c1f-aabd-12392f69f070` | `130a682141e83bda34fccedfe0f87ab263be9155831b53d492e7a8866d518044` | capability evidence | none |
| K04 | Kilo | Nemotron 3 Nano Omni | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | PASS | — | `31be911fc01f4a81f06352ea1e0119fecd3d7ccb5dd1ed5a259eeef68dae7619` | formal smoke only | no file-work proof |
| K05 | Kilo | Nemotron 3 Super | `nvidia/nemotron-3-super-120b-a12b:free` | PASS | `d581b236-7163-405d-a981-86e24617c735` | `6ba5e76fcaa4d87bd831044135a10192371d69ad93cefee8055e3f23b83f5fa0` | capability evidence | none |
| K06 | Kilo | Nemotron 3 Ultra | `nvidia/nemotron-3-ultra-550b-a55b:free` | PASS | — | `9a085212f3b93890bdd61dfde8294b2fb536ce08f0d4c4925e85831fdc21b034` | formal smoke only; later broad provider run timed out | incomplete independent audit |
| K07 | Kilo | Nemotron 3.5 Content Safety | `nvidia/nemotron-3.5-content-safety:free` | PASS | `eac475bc-e541-41f8-a3a5-90648208b487` | `ddc1269f208a34561e2cc68eaec6fd8d66cb2d14e3f029efcdff40aff68e01bc` | response-only safety classifier | not a code-quality vote |
| K08 | Kilo | Nemotron 3.5 Lightning | `nvidia/nemotron-3.5-lightning:free` | PASS | `113a9b36-292c-4e70-bb98-5feb60cf56e0` | `dba1fc650ea21baf4b21c015980a0be33c285b633187ec77630faa1861fa0899` | capability evidence | none |
| K09 | Kilo | Laguna S 2.1 | `poolside/laguna-s-2.1:free` | PASS | `7634bcf9-a08c-45c2-b263-68648d5af971` | `33037de33dbe7b2e899c30003d7c0ae2982840bd6336312f0a7e5f7bb3701108` | capability evidence | none |
| K10 | Kilo | Laguna XS 2.1 | `poolside/laguna-xs-2.1:free` | MODEL_UNAVAILABLE | — | `f6af15dbf7042c4305287f2127eeba9e0f4a54801f0462db27492e406c001b6a` | not adopted | missing response content |
| O01 | OpenCode | Big Pickle | `big-pickle` | PASS | `80a8b1b9-ba47-4209-878c-5060373eaded` | `6000d702ed0d3417cfaffaff7a3dce5b628f1f14af6a9cfb7dee1ca402301076` | response reviewed; final broad packet found no evidenced P0/P1 | wrong probe count |
| O02 | OpenCode | Hy3 Free | `hy3-free` | PASS | `55fccf23-aee9-40bb-a935-88b2001442c4` | `bda337763f0683d6efc18fa99942f80ed5ab202f6e25f1894cec5f79854fbc22` | not adopted | refused requested task |
| O03 | OpenCode | Ling 3.0 Flash Fin Free | `ling-3.0-flash-fin-free` | PASS | `ed44de04-822d-4984-85b6-688964f9001a` | `677afdd05e90abd966dd2820e2deb55dc9ed12e3147fe30524dd4afc39bcc2bc` | response reviewed | wrong probe count |
| O04 | OpenCode | MiMo V2.5 Free | `mimo-v2.5-free` | PASS | `f18fa440-b9e5-455c-9d1f-5ad3d7d17db9` | `4a63c9bf7d70b581f47438f8641f19e5f1afc025f92b5c6adb4a1ba233494b04` | capability evidence | none |
| O05 | OpenCode | Muse Spark 1.2 Free | `muse-spark-1.2-contributor-free` | PASS | `0f18fe55-5bf9-4250-925c-baa45fad9ac4` | `13265eb0b63e9d81ff5a5d325b6ae8a7112c1cdbbf0fe17686ede14fc6b4d1b1` | final broad packet found no evidenced P0/P1 | none |
| O06 | OpenCode | Nemotron 3 Ultra Free | `nemotron-3-ultra-free` | PASS | `5dfdba9b-6419-413f-8ee1-0993d9cfe35f` | `70e81f2f99814356540bdc5a0864c1a295f4aa38a639ec33b61b62e32d5d7509` | capability evidence; same family not double-counted with K06 | none |
| O07 | OpenCode | Nemotron 3.5 Lightning Free | `nemotron-3.5-lightning-free` | PASS | `4686679b-ec5d-4cd6-a71a-4f4d988fa171` | `ea2347e302d1b10f1a1c76e06582e58894a70aac74d487e03fb48c40b3cc7e2d` | capability evidence; same family not double-counted with K08 | none |

## Model finding disposition

- Adopted: scheduler-heartbeat RLS gap, proven by production Prisma error `42501`, fixed by a least-privilege migration and regression tests.
- Adopted: recovery-session establishment and URL-fragment scrubbing, verified through the real recovery/MFA flow.
- Parent-rejected: unsupported model claims that did not match current code, tests, or runtime evidence.
- Duplicate: same-family results through different gateways were not counted as independent votes.
- Unverified: five unavailable exact models and any model run that returned no final text.

## Residual risk and stopping reason

- Five exact requested models remain unavailable: B01, B04, K01, K02, and K10.
- Several responding models produced only formal smoke or a non-compliant response; those outputs are not promoted to independent audit authority.
- The application is deployed and its operational gates passed, but the prompt requires all 22 exact models to run. Therefore `PRODUCTION_GO_CONFIRMED_FREE_TIER` would be inaccurate.
- No user interaction is required. The blocker can clear only when the external providers return valid exact-model responses under the approved zero-cost/non-secret constraints.

## Final judgment

`BLOCKED_EXTERNAL_PROVIDER`

The production service itself is live, rollback-tested, MFA-protected, scheduler-verified, and backed up. Formal GO is withheld solely because the mandatory 22/22 exact-model execution gate is 17/22, with five provider failures. No evidence supports labeling those failures as successful executions.
