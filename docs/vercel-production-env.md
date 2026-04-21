# Vercel Production Environment Variables

Use this exact paste order in the Vercel project under:

1. Project Settings
2. Environment Variables
3. Environment = `Production`

The actual values already live in `.env` and `.env.local`. For secrets generated during this setup, use the exact values now stored in `.env.local`.

## Paste order

1. `DATABASE_URL`
Purpose: production PostgreSQL connection string for Prisma reservations.
Source: current `.env`.

2. `BASE_URL`
Purpose: the public production origin, for example `https://your-domain.example`.
Source: set this to the real production domain. If `.env` still points at localhost, replace it for Vercel.

3. `ADMIN_BASIC_USER`
Purpose: Basic auth username for `/admin` and `/dashboard`.
Source: current `.env`, unless you want a new production-only username.

4. `ADMIN_BASIC_PASS`
Purpose: Basic auth password for `/admin` and `/dashboard`.
Source: use the generated value now stored in `.env.local`.

5. `NEXT_PUBLIC_SUPABASE_URL`
Purpose: public Supabase project URL.
Source: current `.env.local`.

6. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
Purpose: public Supabase anon key.
Source: current `.env.local`.

7. `SUPABASE_SERVICE_ROLE_KEY`
Purpose: server-side Supabase access for orders and bank account management.
Source: current `.env.local`.

8. `CRON_SECRET`
Purpose: bearer secret for cron endpoints.
Source: use the generated value now stored in `.env.local`.

9. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`
Purpose: dedicated encryption key for bank account history.
Source: use the generated value now stored in `.env.local`.
Note: no fallback to other secrets is used.

10. `BANK_ACCOUNT_HISTORY_KEY_VERSION`
Purpose: encryption key version stored with history records.
Source: current `.env.local` (`1`).

11. `STORE_NOTIFY_EMAIL`
Purpose: reservation notification destination for staff.
Source: current `.env`.

12. `EMAIL_PROVIDER`
Purpose: email transport selector.
Source: current `.env`.
Expected value: `resend` or `sendgrid`.

13. `RESEND_API_KEY`
Purpose: Resend API key when `EMAIL_PROVIDER=resend`.
Source: current `.env.local`.
Note: contact/order notification APIs fail when delivery config is missing.

14. `EMAIL_API_KEY`
Purpose: SendGrid API key or fallback generic provider key.
Source: current `.env` if you use it. Omit only if the app is fully standardized on `RESEND_API_KEY`.

15. `EMAIL_FROM`
Purpose: verified sender address for reservation email.
Source: set this to a domain/address already verified by your mail provider.
Do not keep the placeholder value.

16. `ADMIN_EMAIL`
Purpose: store admin notification address for order emails.
Source: current `.env.local`.

17. `STORE_NAME`
Purpose: store name shown in email and store flows.
Source: current `.env.local`.

18. `CONTACT_PHONE_E164`
Purpose: server-side canonical phone number.
Source: current `.env.local`.

19. `CONTACT_PHONE_DISPLAY`
Purpose: display phone number shown to users.
Source: current `.env.local`.

20. `CONTACT_MESSAGE`
Purpose: server-side contact message prefix.
Source: current `.env.local`.

21. `NEXT_PUBLIC_CONTACT_PHONE_E164`
Purpose: client-side phone number.
Source: current `.env.local`.

22. `NEXT_PUBLIC_CONTACT_PHONE_DISPLAY`
Purpose: client-side display phone number.
Source: current `.env.local`.

23. `NEXT_PUBLIC_CONTACT_MESSAGE`
Purpose: client-side contact message prefix.
Source: current `.env.local`.

24. `LINE_CHANNEL_ACCESS_TOKEN`
Purpose: future LINE integration.
Source: only set if you are enabling LINE. Otherwise leave unset.

25. `LINE_CHANNEL_SECRET`
Purpose: future LINE integration.
Source: only set if you are enabling LINE. Otherwise leave unset.

26. `LIFF_ID`
Purpose: future LINE LIFF integration.
Source: only set if you are enabling LINE. Otherwise leave unset.

## Fast path

If you want the exact current values in one go from this machine, run:

```powershell
cd c:\Users\mibum\Desktop\french-restaurant-site\bistro-reservation
.\scripts\print-vercel-env.ps1
```

That script prints the current merged values from `.env` and `.env.local` in the exact order above.
