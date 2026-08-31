# Vercel Production Environment Variables

Use this exact paste order in the Vercel project under:

1. Project Settings
2. Environment Variables
3. Environment = `Production`

The actual values may already exist in your local environment files, but secret values must not be printed into terminal logs, chat, screenshots, or docs.

## Paste order

1. `DATABASE_URL`
Purpose: production PostgreSQL connection string for Prisma reservations.
Source: enter the production database value directly in Vercel without printing it.

2. `DIRECT_URL`
Purpose: direct PostgreSQL connection for Prisma migrations; point it to the same database as `DATABASE_URL` without a pooler.
Source: enter the production migration connection directly in Vercel without printing it.

3. `BASE_URL`
Purpose: the public production origin, for example `https://your-domain.example`.
Source: set this to the real production domain. If `.env` still points at localhost, replace it for Vercel.

4. `NEXT_PUBLIC_SUPABASE_URL`
Purpose: public Supabase project URL.
Source: enter the Supabase value directly in Vercel.

5. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
Purpose: public Supabase anon key.
Source: enter the Supabase value directly in Vercel.

6. `SUPABASE_SERVICE_ROLE_KEY`
Purpose: server-side Supabase access for orders and bank account management.
Source: enter the service role key directly in Vercel without printing it.

7. `STAFF_SESSION_MAX_AGE_SECONDS`
Purpose: maximum individual staff session age in seconds (900–86400; recommended 28800).
Source: set a policy-approved value directly in Vercel.

8. `CRON_SECRET`
Purpose: bearer secret for cron endpoints.
Source: enter the cron secret directly in Vercel without printing it.

9. `BACKUP_EXPORT_SECRET`
Purpose: bearer secret for reservation backup export endpoints.
Source: enter a dedicated backup export secret directly in Vercel without printing it. Do not reuse `CRON_SECRET`.

10. `RATE_LIMIT_HASH_SECRET`
Purpose: HMAC secret for purpose-separated request/IP hashes used by reservation rate limits and audit-safe request metadata.
Source: enter a 32+ character random secret directly in Vercel without printing it.

11. `RESERVATION_TOKEN_KEYS_JSON` + `RESERVATION_TOKEN_ACTIVE_KEY_ID`
Purpose: HMAC keyring used to re-derive reservation management and LINE-link bearer tokens without storing their raw values.
Source: enter the JSON keyring and active key ID directly in Vercel. Keep old keys until the 180-day management-link lifetime expires.

12. `BACKUP_ENCRYPTION_KEYS_JSON` + `BACKUP_ENCRYPTION_ACTIVE_KEY_ID`
Purpose: AES-256-GCM backup keyring with explicit key IDs for rotation and restore drills.
Source: enter the JSON keyring and active key ID directly in Vercel or the backup runner environment.

13. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`
Purpose: dedicated encryption key for bank account history.
Source: enter the encryption key directly in Vercel without printing it.
Note: no fallback to other secrets is used.

14. `BANK_ACCOUNT_HISTORY_KEY_VERSION`
Purpose: encryption key version stored with history records.
Source: current `.env.local` (`1`).

15. `STORE_NOTIFY_EMAIL`
Purpose: reservation notification destination for staff.
Source: current `.env`.

16. `EMAIL_PROVIDER`
Purpose: email transport selector.
Source: current `.env`.
Expected value: `resend` or `sendgrid`.

17. `RESEND_API_KEY`
Purpose: Resend API key when `EMAIL_PROVIDER=resend`.
Source: current `.env.local`.
Note: contact/order notification APIs fail when delivery config is missing.

18. `EMAIL_API_KEY`
Purpose: SendGrid API key or fallback generic provider key.
Source: current `.env` if you use it. Omit only if the app is fully standardized on `RESEND_API_KEY`.

19. `EMAIL_FROM`
Purpose: verified sender address for reservation email.
Source: set this to a domain/address already verified by your mail provider.
Do not keep the placeholder value.

20. `ADMIN_EMAIL`
Purpose: store admin notification address for order emails.
Source: current `.env.local`.

21. `STORE_NAME`
Purpose: store name shown in email and store flows.
Source: current `.env.local`.

22. `CONTACT_PHONE_E164`
Purpose: server-side canonical phone number.
Source: current `.env.local`.

23. `CONTACT_PHONE_DISPLAY`
Purpose: display phone number shown to users.
Source: current `.env.local`.

24. `CONTACT_MESSAGE`
Purpose: server-side contact message prefix.
Source: current `.env.local`.

25. `NEXT_PUBLIC_CONTACT_PHONE_E164`
Purpose: client-side phone number.
Source: current `.env.local`.

26. `NEXT_PUBLIC_CONTACT_PHONE_DISPLAY`
Purpose: client-side display phone number.
Source: current `.env.local`.

27. `NEXT_PUBLIC_CONTACT_MESSAGE`
Purpose: client-side contact message prefix.
Source: current `.env.local`.

28. `LINE_CHANNEL_ACCESS_TOKEN`
Purpose: future LINE integration.
Source: only set if you are enabling LINE. Otherwise leave unset.

29. `LINE_CHANNEL_SECRET`
Purpose: future LINE integration.
Source: only set if you are enabling LINE. Otherwise leave unset.

30. `NEXT_PUBLIC_LIFF_BOOKING_ID`
Purpose: LIFF ID for /booking page (LINE LIFF integration).
Source: LINE Developers Console > LIFF タブ. Endpoint: https://本番ドメイン/booking

31. `NEXT_PUBLIC_LIFF_LINK_ID`
Purpose: LIFF ID for /line/link page (reservation linking).
Source: LINE Developers Console > LIFF タブ. Endpoint: https://本番ドメイン/line/link

32. `LINE_LINK_TOKEN_PEPPER`
Purpose: HMAC pepper for reservation link tokens (32 chars minimum in production).
Source: generate with: openssl rand -base64 32

33. `LINE_MONTHLY_REMINDER_LIMIT` (optional, default 200)
Purpose: Monthly LINE push notification hard limit.

34. `LINE_MONTHLY_REMINDER_WARN_THRESHOLD` (optional, default 180)
Purpose: Monthly LINE push notification warning threshold.

Note: `LIFF_ID` (旧名) は廃止。設定不要。

## Presence check

To check which keys are present locally without printing secret values, run:

```powershell
cd c:\Users\mibum\Desktop\french-restaurant-site\bistro-reservation
.\scripts\print-vercel-env.ps1
```

That script prints only `<set>` markers. It must not be used as a copy-paste source for secret values.
