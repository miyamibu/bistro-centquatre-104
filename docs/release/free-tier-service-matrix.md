# Free-tier service matrix

Policy/product documentation and authenticated account evidence verified through 2026-08-31. `Current evidence` is separate from published capability; an undocumented account assumption is never promoted to PASS.

| Service | Published free-plan facts | Commercial use / cost safety | Current evidence | Decision |
| --- | --- | --- | --- | --- |
| Vercel | Hobby has usage limits and cannot provide the required high-frequency cron | Hobby is restricted to non-commercial personal use; no upgrade/trial/card is authorized | Bistro Git integration disconnected; three Bistro production aliases removed and return HTTP 404. Historical immutable deployment URLs may still exist but are not production aliases. | `RETIRED_FOR_BISTRO_COMMERCIAL_TRAFFIC` |
| Netlify | Free: 300 monthly credits and a hard limit; Next.js/OpenNext and scheduled functions are supported | Commercial projects allowed; account API confirms Free, 300 credits, no Stripe payment method, auto top-up disabled, and no active trial | Production deploy is ready on the release SHA; public, admin, scheduler, failsafe, and rollback checks pass. | `SELECTED_PRODUCTION` |
| GitHub Actions | Public repositories can use standard hosted runners without metered runner charges; schedule minimum is five minutes and may be delayed | Commercial use allowed; larger/paid runner paths prohibited | Public repo; release main CI and Security checks pass; post-repromotion notification workflow `33348816911` passes. | `KEEP_PRIMARY_SCHEDULER` |
| PostgreSQL / Supabase | Free docs list 500 MB DB and 5 GB egress | No paid change authorized | Production migration/RLS/runtime grants pass with the operational-audit policy fix; reservation and notification backlogs are empty at check. | `KEEP_PRODUCTION` |
| Supabase Auth | Free docs list 50,000 MAU and required auth primitives | No paid change authorized | Intended administrator is confirmed, signed in, ADMIN-provisioned, enrolled in verified TOTP, and passed AAL2 protected-page access. | `KEEP_PRODUCTION_MFA` |
| Resend | Free docs list 3,000 emails/month and 100/day | Application batches remain bounded; no paid plan authorized | Provider settings and durable email Outbox are active; no real-customer canary was sent. Account-plan screen remains a separate observation. | `KEEP_BOUNDED_NO_CUSTOMER_CANARY` |
| LINE Messaging API | Japan Communication plan documents 200 free messages/month | Application warns below the configured cap | Provider settings, sent event history, durable scheduling, and failsafe lane pass; no real-customer canary was sent. | `KEEP_BOUNDED_NO_CUSTOMER_CANARY` |

## Product and UX consequences

- The exact Netlify Preview was visually checked at 390 px width: no horizontal overflow or provider badge obstruction was observed, and all booking availability requests reached HTTP 200.
- GitHub schedule is best-effort. Immediate processing, durable Outbox, heartbeat, manual drain, and daily failsafe are required together.
- A hard free limit may pause the site. Pausing is preferable to unauthorized billing, but usage monitoring remains mandatory.

## Official sources

- Vercel Hobby: <https://vercel.com/docs/plans/hobby>
- Vercel fair use: <https://vercel.com/docs/limits/fair-use-guidelines>
- GitHub Actions billing: <https://docs.github.com/en/billing/concepts/product-billing/github-actions>
- GitHub schedule semantics: <https://docs.github.com/actions/using-workflows/events-that-trigger-workflows>
- Netlify pricing: <https://www.netlify.com/pricing/>
- Netlify Free commercial/no-card/hard-stop: <https://www.netlify.com/blog/introducing-netlify-free-plan/>
- Netlify credit model: <https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/>
- Netlify Next.js: <https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/>
- Netlify scheduled functions: <https://docs.netlify.com/build/functions/scheduled-functions/>
- Netlify Free badge change: <https://www.netlify.com/changelog/2026-08-19-pre-launch-toolbar-and-powered-by-netlify-badge/>
- Prisma on Netlify: <https://www.prisma.io/docs/orm/more/troubleshooting/nextjs>
- Supabase pricing/cost control: <https://supabase.com/pricing>, <https://supabase.com/docs/guides/platform/cost-control>
- Resend pricing: <https://resend.com/pricing>
- LINE pricing: <https://developers.line.biz/en/docs/messaging-api/pricing-jp/>
