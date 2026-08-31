# Free-tier service matrix

Policy/product documentation verified on 2026-08-26. `Current evidence` is separate from published capability; an undocumented account assumption is never promoted to PASS.

| Service | Published free-plan facts | Commercial use / cost safety | Current evidence | Decision |
| --- | --- | --- | --- | --- |
| Vercel | Hobby has usage limits and cannot provide the required high-frequency cron | Hobby is restricted to non-commercial personal use; no upgrade/trial/card is authorized | Authenticated project is Hobby; existing commercial deployment is older than the candidate; candidate has zero Vercel crons | `KEEP_HOBBY_STOP_COMMERCIAL_TRAFFIC` |
| Netlify | Free: 300 monthly credits and a hard limit; Next.js/OpenNext and scheduled functions are supported | Commercial projects allowed; Free has no paid overage and requires no card | Offline build passed; CLI is unauthenticated; Preview/Production and account plan screen are unverified | `SELECTED_BLOCKED_LOGIN` |
| GitHub Actions | Public repositories can use standard hosted runners without metered runner charges; schedule minimum is five minutes and may be delayed | Commercial use allowed; larger/paid runner paths prohibited | Public repo; workflows use `ubuntu-latest`, no checkout/cache/artifact; cron secret exists; URL secret waits for Netlify | `KEEP` |
| PostgreSQL / Supabase | Free docs list 500 MB DB and 5 GB egress | No paid change authorized | Production DB is about 14.56 MB; schema verification and 23 migrations pass; account plan/billing screen not captured | `KEEP_PENDING_ACCOUNT_CONFIRMATION` |
| Supabase Auth | Free docs list 50,000 MAU and required auth primitives | No paid change authorized | Staff role/AAL2/login-age code and tests pass; account plan/usage screen not captured | `KEEP_PENDING_ACCOUNT_CONFIRMATION` |
| Resend | Free docs list 3,000 emails/month and 100/day | Application batches remain bounded; no paid plan authorized | Provider settings exist; no external canary sent; plan/usage screen unverified | `KEEP_PENDING_ACCOUNT_CONFIRMATION` |
| LINE Messaging API | Japan Communication plan documents 200 free messages/month | Application warns below the configured cap | Provider settings exist; production canary and usage screen unverified | `KEEP_PENDING_ACCOUNT_CONFIRMATION` |

## Product and UX consequences

- New Netlify Free public sites may show a Netlify badge/pre-launch toolbar under the provider's current rollout. Preview must visually verify it; this is not silently accepted as a design change.
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
