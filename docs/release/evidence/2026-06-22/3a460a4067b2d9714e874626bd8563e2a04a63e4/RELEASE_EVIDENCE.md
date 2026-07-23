# bistro centquatre 104 release evidence

Date: 2026-06-22 JST
RC SHA: `3a460a4067b2d9714e874626bd8563e2a04a63e4`
Branch: `release/go-readiness-20260622`
Verdict: `NO_GO / NOT_READY`

## Confirmed

- GitHub CI: `Reservation Hardening CI` run `27928022298`, conclusion `success`, head SHA `3a460a4067b2d9714e874626bd8563e2a04a63e4`.
- Production deployment: Vercel deployment `dpl_3RpHZXcaHuSohiKvTnJ9PY8PUZLA`, target `production`, status `READY`.
- Production URL: `https://bistro-centquatre-104.vercel.app`.
- Production smoke artifacts: `production-smoke/`.
- Physical iPhone artifacts: `device/iphone-final/`.
- Physical Android Pixel 9a artifacts: `device/android-final/`.

## Production Smoke

Saved under `production-smoke/`.

- `/`
- `/booking`
- `/on-line-store/cart`
- `/agents`
- `/llms.txt`
- `/api/agent`
- `/api/availability?date=2026-06-25&servicePeriod=DINNER&partySize=2`
- `/api/availability/monthly?month=2026-06&servicePeriod=DINNER&partySize=2`

## Device Evidence

### iPhone

Backend: Appium/XCUITest native screenshots with Safari address-bar control.

Saved under `device/iphone-final/`.

- `home.png`
- `booking.png`
- `cart.png`
- `agents.png`
- `admin.png`

Notes:

- `/booking` showed the bistro reservation calendar on physical iPhone Safari.
- `/admin` showed the browser Basic authentication prompt. Admin credentials were not entered or recorded.

### Android

Device: Pixel 9a via ADB and Chrome.

Saved under `device/android-final/`.

- `home.png`
- `booking.png`
- `cart.png`
- `agents.png`
- `admin.png`

Notes:

- Earlier Android screenshots under `device/android/` were black because the device was locked/dozing; they are not accepted as proof.
- `device/android-final/booking.png` was visually checked and shows the bistro reservation calendar.
- `device/android-final/admin.png` shows the Basic authentication prompt. Admin credentials were not intentionally entered for release validation.

## DB / Cron

- Production DB migration and post-check completed before final smoke.
- Production cron endpoint `process-order-notifications` returned HTTP 200 with an empty outbox scan result.
- Because the Vercel Hobby plan rejected the original high-frequency cron schedule, `process-order-notifications` was reduced to daily. This keeps deploy green but does not satisfy the original operations-ready expectation for timely outbox processing.

## Blocking Items

The release remains `NO_GO / NOT_READY` because:

- Preview same-SHA verification was skipped by user choice.
- Preview environment separation proof is absent.
- Order notification outbox cron frequency is reduced to daily.
- LINE end-to-end delivery, mail end-to-end delivery, monitoring alert, backup freshness, restore drill, rollback drill, and store/legal approval evidence are not fully closed.
- Vercel CLI JSON did not expose production deployment git SHA metadata; same-SHA production provenance is supported by clean worktree deployment plus CI SHA, but not independently read back from Vercel metadata.

Final statement: `Status: PARTIALLY_COMPLETED / Release Decision: NO_GO / Operations: NOT_READY`.
