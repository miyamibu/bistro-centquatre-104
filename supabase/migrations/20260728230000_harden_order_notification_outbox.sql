alter table public.order_notification_outbox
  add column if not exists claim_token uuid,
  add column if not exists customer_sent_at timestamptz,
  add column if not exists admin_sent_at timestamptz,
  add column if not exists admin_skipped_at timestamptz;

alter table public.order_notification_outbox
  drop constraint if exists order_notification_outbox_admin_delivery_state_check;

alter table public.order_notification_outbox
  add constraint order_notification_outbox_admin_delivery_state_check
  check (not (admin_sent_at is not null and admin_skipped_at is not null));
