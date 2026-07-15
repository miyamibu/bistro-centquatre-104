# DESIGN.md

## Goal
Keep the Bistro Joa reservation site refined, trustworthy, and easy to book while preserving the existing reservation, store, and admin workflows.

## Context
- Product: restaurant reservation site with online store and admin/dashboard surfaces.
- Stack: Next.js App Router, React, TypeScript, Tailwind CSS, Prisma/PostgreSQL for reservations, Supabase for orders.
- Main routes live in `src/app`; reusable components live in `src/components`.
- Existing component systems include custom primitives (`button`, `card`, `column`, `select`, state/material layers), shadcn-style `src/components/ui/*`, and `lucide-react`.
- Design proposals exist under the parent folder's `design-proposals/`; backup folders must not be synchronized or cleaned up without approval.

## Source Of Truth
1. Current explicit user instruction.
2. Existing `src/app`, `src/components`, Tailwind config, and current booking/admin behavior.
3. This `DESIGN.md`.
4. Approved Figma/design files or approved proposal HTML.
5. Screenshots or `gpt-image-2` generated images.
6. Ambiguous natural-language preferences.

If sources conflict, explain the conflict before changing the UI direction.

## UX Principles
- Booking must feel calm, premium, and low-friction. Do not change booking form behavior unless explicitly requested or necessary.
- Public pages should support trust, access, menu understanding, and reservation conversion without becoming a marketing-only landing page.
- Admin and dashboard screens should prioritize scanability, status clarity, and safe operations over decorative layout.
- Reservation state changes must be reversible/status-based where the existing model requires it. Never design UI around destructive deletion.
- Store/order pages should make cart, payment, delivery/pickup, and completion states explicit.

## Visual Direction
- Maintain a refined restaurant tone: restrained contrast, careful whitespace, readable Japanese copy, and food/venue imagery when available.
- Reuse existing Tailwind conventions and component primitives before introducing new patterns.
- Keep cards at modest radius and avoid nested cards.
- Avoid generic single-hue themes, excessive gradients, and decorative background effects.
- Customer-facing pages may be more atmospheric; admin screens should remain denser and operational.

## Layout
- Customer pages: prioritize reservation CTA, menu/store access, business/access information, and contact paths.
- Booking flow: keep fields grouped, validation close to inputs, and progress/error states easy to recover from.
- Admin/dashboard: use compact tables/lists, stable action placement, and clear filters/status labels.
- Responsive layouts must avoid clipped Japanese text, overlapping buttons, and hidden primary actions.

## Components
- Prefer existing components in `src/components` and `src/components/ui`.
- Use `lucide-react` only where it is already appropriate and available.
- Loading, empty, error, closed-day, fully-booked, private-block, cancelled, no-show, done, cart-empty, and order-complete states must be explicit when touched.
- Copy changes that affect customer booking confidence should be reviewed as UX changes, not mere text edits.

## Accessibility
- Preserve semantic forms, labels, error messages, and keyboard navigation.
- Do not communicate reservation availability or danger states by color alone.
- Maintain touch-friendly controls on mobile.
- Check focus visibility and contrast for overlays, dialogs, forms, and admin tables.

## Validation
For UI changes, run the most relevant checks available:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build` for larger changes or release-sensitive work.
- Browser review of affected routes on desktop and mobile widths.
- For substantial UI work, save screenshots and command outputs under `artifacts/ui-review/YYYY-MM-DD/` when possible.

## Avoid
- Changing booking UX, reservation state semantics, or admin friction without explaining why.
- New dependencies without approval.
- Treating generated images or proposal HTML as implementation specs.
- Editing backup folders, canonical copies, or production evidence without explicit instruction.
- Replacing the existing design system with a new one.
