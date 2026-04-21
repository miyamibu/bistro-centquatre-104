-- Reconcile older order schema snapshots so supabase/schema.sql can be applied safely.
-- Run this once before rerunning supabase/schema.sql on environments that already have
-- partial orders/order_history/bank_account tables from an older draft.

create extension if not exists pgcrypto;

alter table if exists public.orders
  add column if not exists building text,
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists total integer not null default 0,
  add column if not exists store_visit_date date,
  add column if not exists hold_expires_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists human_confirmed_at timestamptz,
  add column if not exists human_confirmed_expires_at timestamptz,
  add column if not exists human_confirmed_by text,
  add column if not exists paid_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists version integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.orders
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column version set default 0;

alter table if exists public.order_history
  add column if not exists building text,
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists total integer not null default 0,
  add column if not exists store_visit_date date,
  add column if not exists paid_at timestamptz,
  add column if not exists shipped_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists version integer not null default 0,
  add column if not exists deleted_at timestamptz not null default now();

alter table if exists public.order_history
  alter column created_at set default now(),
  alter column version set default 0;

alter table if exists public.bank_account
  add column if not exists id uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.bank_account
set id = gen_random_uuid()
where id is null;

alter table if exists public.bank_account
  alter column id set default gen_random_uuid(),
  alter column created_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if to_regclass('public.bank_account') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.bank_account'::regclass
         and conname = 'bank_account_pkey'
     ) then
    alter table public.bank_account
      add constraint bank_account_pkey primary key (id);
  end if;
end
$$;

do $$
begin
  if to_regclass('public.orders') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.orders'::regclass
         and conname = 'orders_payment_method_check_v2'
     ) then
    alter table public.orders
      add constraint orders_payment_method_check_v2
      check (payment_method in ('BANK_TRANSFER', 'PAY_IN_STORE') or payment_method is null);
  end if;
end
$$;

do $$
begin
  if to_regclass('public.orders') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.orders'::regclass
         and conname = 'orders_status_check_v2'
     ) then
    alter table public.orders
      add constraint orders_status_check_v2
      check (status in ('QUOTED', 'PENDING_PAYMENT', 'PAID', 'SHIPPED', 'CANCELLED'));
  end if;
end
$$;

do $$
begin
  if to_regclass('public.order_history') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.order_history'::regclass
         and conname = 'order_history_payment_method_check_v2'
     ) then
    alter table public.order_history
      add constraint order_history_payment_method_check_v2
      check (payment_method in ('BANK_TRANSFER', 'PAY_IN_STORE') or payment_method is null);
  end if;
end
$$;

do $$
begin
  if to_regclass('public.order_history') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.order_history'::regclass
         and conname = 'order_history_status_check_v2'
     ) then
    alter table public.order_history
      add constraint order_history_status_check_v2
      check (status in ('SHIPPED', 'CANCELLED'));
  end if;
end
$$;
