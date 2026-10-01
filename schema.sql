-- KostPay: skema awal untuk Supabase / PostgreSQL.
-- Jalankan seluruh file ini di Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  monthly_price bigint not null check (monthly_price >= 0),
  status text not null default 'available' check (status in ('available', 'occupied', 'maintenance')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text,
  room_id uuid not null references public.rooms(id) on delete restrict,
  move_in_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period date not null,
  amount bigint not null check (amount >= 0),
  due_date date not null,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'overdue')),
  created_at timestamptz not null default now(),
  unique (tenant_id, period)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  paid_at date not null default current_date,
  amount bigint not null check (amount > 0),
  method text not null check (method in ('transfer', 'cash', 'ewallet')),
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists tenants_room_id_idx on public.tenants(room_id);
create index if not exists invoices_tenant_id_idx on public.invoices(tenant_id);
create index if not exists payments_invoice_id_idx on public.payments(invoice_id);
create index if not exists payments_paid_at_idx on public.payments(paid_at);

create or replace function public.sync_invoice_status_from_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_invoice_id uuid;
  new_invoice_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_invoice_id := old.invoice_id;
  end if;
  if tg_op <> 'DELETE' then
    new_invoice_id := new.invoice_id;
  end if;

  if old_invoice_id is not null then
    update public.invoices as invoice
    set status = case
      when coalesce((select sum(payment.amount) from public.payments as payment where payment.invoice_id = invoice.id), 0) >= invoice.amount then 'paid'
      when invoice.due_date < current_date then 'overdue'
      else 'unpaid'
    end
    where invoice.id = old_invoice_id;
  end if;

  if new_invoice_id is not null and new_invoice_id is distinct from old_invoice_id then
    update public.invoices as invoice
    set status = case
      when coalesce((select sum(payment.amount) from public.payments as payment where payment.invoice_id = invoice.id), 0) >= invoice.amount then 'paid'
      when invoice.due_date < current_date then 'overdue'
      else 'unpaid'
    end
    where invoice.id = new_invoice_id;
  end if;

  return null;
end;
$$;

drop trigger if exists sync_invoice_status_after_payment_change on public.payments;
create trigger sync_invoice_status_after_payment_change
after insert or update or delete on public.payments
for each row execute function public.sync_invoice_status_from_payments();

alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.rooms to anon, authenticated;
grant select, insert, update, delete on public.tenants to anon, authenticated;
grant select, insert, update, delete on public.invoices to anon, authenticated;
grant select, insert, update, delete on public.payments to anon, authenticated;

drop policy if exists "KostPay access rooms" on public.rooms;
create policy "KostPay access rooms" on public.rooms for all to anon, authenticated using (true) with check (true);
drop policy if exists "KostPay access tenants" on public.tenants;
create policy "KostPay access tenants" on public.tenants for all to anon, authenticated using (true) with check (true);
drop policy if exists "KostPay access invoices" on public.invoices;
create policy "KostPay access invoices" on public.invoices for all to anon, authenticated using (true) with check (true);
drop policy if exists "KostPay access payments" on public.payments;
create policy "KostPay access payments" on public.payments for all to anon, authenticated using (true) with check (true);
