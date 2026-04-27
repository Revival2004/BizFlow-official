-- ============================================================
-- BIZFLOW - COMPLETE SUPABASE SQL SETUP
-- Paste this ENTIRE file into Supabase SQL Editor and click Run
-- ============================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- 2. CORE TABLES
-- ============================================================

-- Businesses
create table if not exists public.businesses (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  display_name text,
  email       text,
  phone       text,
  address     text,
  currency    text default 'GBP',
  logo_url    text,
  status      text default 'active',
  owner_name  text,
  owner_email text,
  owner_user_id uuid,
  created_by  uuid,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Roles (one set per business)
create table if not exists public.roles (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade,
  name        text not null,
  permissions jsonb not null default '{}',
  created_at  timestamptz default now()
);

-- Profiles (one per auth user)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  role_id     uuid references public.roles(id),
  email       text not null,
  full_name   text not null,
  phone       text,
  status      text default 'active' check (status in ('active','inactive','suspended')),
  is_super_admin boolean default false,
  invited_by  uuid,
  avatar_url  text,
  last_seen   timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Invitations
create table if not exists public.invitations (
  id           uuid primary key default uuid_generate_v4(),
  business_id  uuid references public.businesses(id) on delete cascade,
  email        text not null,
  role_id      uuid references public.roles(id),
  token        text unique not null,
  status       text default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by   uuid,
  accepted_by  uuid,
  accepted_at  timestamptz,
  created_at   timestamptz default now()
);

-- Super-admin generated client access tokens
create table if not exists public.client_access_tokens (
  id               uuid primary key default uuid_generate_v4(),
  token            text unique not null,
  admin_email      text,
  business_name    text,
  notes            text,
  status           text not null default 'active' check (status in ('active','used','revoked','expired')),
  created_by       uuid,
  used_by          uuid,
  used_business_id uuid references public.businesses(id) on delete set null,
  expires_at       timestamptz not null default (now() + interval '30 days'),
  used_at          timestamptz,
  created_at       timestamptz default now()
);

-- Business-owned payment settings
create table if not exists public.business_payment_settings (
  id               uuid primary key default uuid_generate_v4(),
  business_id      uuid unique references public.businesses(id) on delete cascade,
  provider         text not null default 'mpesa' check (provider in ('mpesa')),
  is_enabled       boolean not null default false,
  environment      text not null default 'sandbox' check (environment in ('sandbox','live')),
  till_type        text not null default 'paybill' check (till_type in ('paybill','till')),
  shortcode        text,
  consumer_key     text,
  consumer_secret  text,
  passkey          text,
  account_reference text,
  callback_secret  text not null default encode(gen_random_bytes(18), 'hex'),
  last_test_status text,
  last_tested_at   timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Categories
create table if not exists public.categories (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade,
  name        text not null,
  color       text default '#3B5BDB',
  icon        text default 'grid',
  created_at  timestamptz default now()
);

-- Products / Stock
create table if not exists public.products (
  id             uuid primary key default uuid_generate_v4(),
  business_id    uuid references public.businesses(id) on delete cascade,
  category_id    uuid references public.categories(id),
  name           text not null,
  description    text,
  sku            text,
  barcode        text,
  cost_price     numeric(12,2) not null default 0,
  selling_price  numeric(12,2) not null default 0,
  quantity       integer not null default 0,
  reorder_level  integer default 5,
  unit           text default 'pcs',
  is_active      boolean default true,
  image_url      text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Stock Movements (full audit trail)
create table if not exists public.stock_movements (
  id           uuid primary key default uuid_generate_v4(),
  product_id   uuid references public.products(id) on delete cascade,
  business_id  uuid references public.businesses(id) on delete cascade,
  type         text not null check (type in ('sale','restock','adjustment','initial','void','transfer','damage','return')),
  quantity     integer not null,
  reference    text,
  performed_by uuid,
  notes        text,
  created_at   timestamptz default now()
);

-- Sales
create table if not exists public.sales (
  id                uuid primary key default uuid_generate_v4(),
  business_id       uuid references public.businesses(id) on delete cascade,
  reference_number  text unique not null,
  sold_by           uuid,
  customer_name     text,
  customer_phone    text,
  total_amount      numeric(12,2) not null default 0,
  cost_total        numeric(12,2) default 0,
  profit            numeric(12,2) default 0,
  discount_amount   numeric(12,2) default 0,
  tax_amount        numeric(12,2) default 0,
  payment_method    text default 'cash' check (payment_method in ('cash','card','transfer','mixed','mpesa')),
  amount_tendered   numeric(12,2) default 0,
  change_given      numeric(12,2) default 0,
  status            text default 'completed' check (status in ('completed','voided','refunded','pending')),
  items_count       integer default 0,
  notes             text,
  voided_by         uuid,
  voided_at         timestamptz,
  void_reason       text,
  created_at        timestamptz default now()
);

-- External payment intents
create table if not exists public.payment_intents (
  id                       uuid primary key default uuid_generate_v4(),
  business_id              uuid references public.businesses(id) on delete cascade,
  created_by               uuid references public.profiles(id) on delete set null,
  sale_id                  uuid references public.sales(id) on delete set null,
  reference_number         text not null,
  provider                 text not null default 'mpesa' check (provider in ('mpesa')),
  customer_name            text,
  customer_phone           text not null,
  amount                   numeric(12,2) not null,
  currency                 text default 'KES',
  status                   text not null default 'pending' check (status in ('pending','initiated','paid','completed','failed','cancelled','expired')),
  sale_payload             jsonb not null default '{}'::jsonb,
  items_payload            jsonb not null default '[]'::jsonb,
  mpesa_checkout_request_id text,
  mpesa_merchant_request_id text,
  mpesa_receipt_number     text,
  mpesa_result_code        integer,
  mpesa_result_desc        text,
  raw_initiation_response  jsonb,
  raw_callback_response    jsonb,
  last_polled_at           timestamptz,
  paid_at                  timestamptz,
  completed_at             timestamptz,
  error_message            text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- Sale Line Items
create table if not exists public.sale_items (
  id            uuid primary key default uuid_generate_v4(),
  sale_id       uuid references public.sales(id) on delete cascade,
  product_id    uuid references public.products(id),
  product_name  text not null,
  quantity      integer not null,
  unit_price    numeric(12,2) not null,
  cost_price    numeric(12,2) default 0,
  total_price   numeric(12,2) not null,
  profit        numeric(12,2) default 0,
  discount      numeric(12,2) default 0,
  created_at    timestamptz default now()
);

-- Expenses
create table if not exists public.expenses (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade,
  category    text not null,
  description text not null,
  amount      numeric(12,2) not null,
  date        date default current_date,
  recorded_by uuid,
  receipt_url text,
  created_at  timestamptz default now()
);

-- Notifications
create table if not exists public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  business_id uuid references public.businesses(id) on delete cascade,
  user_id     uuid,
  type        text not null,
  title       text not null,
  message     text,
  is_read     boolean default false,
  data        jsonb,
  created_at  timestamptz default now()
);

-- ============================================================
-- 3. ALIGN EXISTING PROJECTS
-- ============================================================
alter table public.businesses alter column currency set default 'KES';
alter table public.businesses add column if not exists status text default 'active';
alter table public.businesses add column if not exists display_name text;
alter table public.businesses add column if not exists owner_name text;
alter table public.businesses add column if not exists owner_email text;
alter table public.businesses add column if not exists owner_user_id uuid;
alter table public.businesses add column if not exists created_by uuid;
alter table public.profiles add column if not exists is_super_admin boolean default false;
alter table public.invitations add column if not exists status text default 'pending';
alter table public.sales add column if not exists status text default 'completed';
alter table public.client_access_tokens add column if not exists status text default 'active';

update public.businesses
set status = 'active'
where status is null;

update public.businesses
set display_name = trim(coalesce(name, ''))
where display_name is null or trim(display_name) = '';

update public.profiles
set is_super_admin = false
where is_super_admin is null;

update public.invitations
set status = 'pending'
where status is null;

update public.sales
set status = 'completed'
where status is null;

update public.client_access_tokens
set status = 'active'
where status is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'businesses_status_check'
  ) then
    alter table public.businesses
      add constraint businesses_status_check
      check (status in ('active','suspended'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'stock_movements_performed_by_fkey'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_performed_by_fkey
      foreign key (performed_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_sold_by_fkey'
  ) then
    alter table public.sales
      add constraint sales_sold_by_fkey
      foreign key (sold_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_voided_by_fkey'
  ) then
    alter table public.sales
      add constraint sales_voided_by_fkey
      foreign key (voided_by) references public.profiles(id) on delete set null;
  end if;

  if exists (
    select 1 from pg_constraint where conname = 'sales_payment_method_check'
  ) then
    alter table public.sales
      drop constraint sales_payment_method_check;
  end if;

  alter table public.sales
    add constraint sales_payment_method_check
    check (payment_method in ('cash','card','transfer','mixed','mpesa'));
end $$;

-- ============================================================
-- 4. INDEXES
-- ============================================================
create index if not exists idx_products_business    on public.products(business_id);
create index if not exists idx_sales_business       on public.sales(business_id);
create index if not exists idx_sales_created        on public.sales(created_at desc);
create index if not exists idx_sales_status         on public.sales(business_id, status);
create index if not exists idx_payment_intents_business_status on public.payment_intents(business_id, status, created_at desc);
create index if not exists idx_payment_intents_checkout on public.payment_intents(mpesa_checkout_request_id);
create index if not exists idx_payment_intents_reference on public.payment_intents(reference_number);
create index if not exists idx_sale_items_sale      on public.sale_items(sale_id);
create index if not exists idx_stock_mov_product    on public.stock_movements(product_id);
create index if not exists idx_profiles_business    on public.profiles(business_id);
create index if not exists idx_invitations_token    on public.invitations(token);
create index if not exists idx_invitations_email    on public.invitations(email);
create index if not exists idx_businesses_status    on public.businesses(status);
create index if not exists idx_access_tokens_status on public.client_access_tokens(status);
create index if not exists idx_access_tokens_token  on public.client_access_tokens(token);
create index if not exists idx_payment_settings_business on public.business_payment_settings(business_id);

-- ============================================================
-- 5. HELPER FUNCTIONS
-- ============================================================

create or replace function public.my_business_id()
returns uuid language sql stable security definer as $$
  select business_id from public.profiles where id = auth.uid()
$$;

create or replace function public.super_admin_email()
returns text language sql stable security definer as $$
  select 'revivalthuranira@gmail.com'::text
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer as $$
  select coalesce((
    select p.is_super_admin
      and lower(trim(coalesce(p.email, ''))) = public.super_admin_email()
    from public.profiles p
    where p.id = auth.uid()
  ), false)
$$;

create or replace function public.my_role()
returns text language sql stable security definer as $$
  select r.name
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
$$;

create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer as $$
  select coalesce(
    (select (r.permissions->>perm)::boolean
     from public.profiles p
     join public.roles r on r.id = p.role_id
     where p.id = auth.uid()),
    false
  )
$$;

create or replace function public.create_default_roles(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_role_id uuid;
begin
  insert into public.roles(business_id, name, permissions) values (p_business_id, 'admin',
    '{"view_dashboard":true,"view_sales":true,"create_sale":true,"void_sale":true,"view_stock":true,"add_stock":true,"edit_stock":true,"delete_stock":true,"view_reports":true,"export_reports":true,"manage_staff":true,"invite_staff":true,"view_profits":true,"manage_categories":true,"manage_payments":true}'
  ) returning id into v_admin_role_id;

  insert into public.roles(business_id, name, permissions) values (p_business_id, 'sales_manager',
    '{"view_dashboard":true,"view_sales":true,"create_sale":true,"void_sale":true,"view_stock":true,"add_stock":false,"edit_stock":false,"delete_stock":false,"view_reports":true,"export_reports":true,"manage_staff":false,"invite_staff":false,"view_profits":true,"manage_categories":false,"manage_payments":false}'
  );

  insert into public.roles(business_id, name, permissions) values (p_business_id, 'cashier',
    '{"view_dashboard":true,"view_sales":true,"create_sale":true,"void_sale":false,"view_stock":true,"add_stock":false,"edit_stock":false,"delete_stock":false,"view_reports":false,"export_reports":false,"manage_staff":false,"invite_staff":false,"view_profits":false,"manage_categories":false,"manage_payments":false}'
  );

  insert into public.roles(business_id, name, permissions) values (p_business_id, 'stock_manager',
    '{"view_dashboard":true,"view_sales":false,"create_sale":false,"void_sale":false,"view_stock":true,"add_stock":true,"edit_stock":true,"delete_stock":true,"view_reports":true,"export_reports":false,"manage_staff":false,"invite_staff":false,"view_profits":false,"manage_categories":true,"manage_payments":false}'
  );

  insert into public.roles(business_id, name, permissions) values (p_business_id, 'accountant',
    '{"view_dashboard":true,"view_sales":true,"create_sale":false,"void_sale":false,"view_stock":true,"add_stock":false,"edit_stock":false,"delete_stock":false,"view_reports":true,"export_reports":true,"manage_staff":false,"invite_staff":false,"view_profits":true,"manage_categories":false,"manage_payments":false}'
  );

  return v_admin_role_id;
end;
$$;

update public.roles
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object('manage_payments', true)
where name = 'admin'
  and coalesce((permissions->>'manage_payments')::boolean, false) = false;

update public.roles
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object('manage_payments', false)
where name in ('sales_manager', 'cashier', 'stock_manager', 'accountant')
  and not (coalesce(permissions, '{}'::jsonb) ? 'manage_payments');

create or replace function public.create_default_categories(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories(business_id, name, color, icon) values
    (p_business_id, 'General',        '#3B5BDB', 'grid'),
    (p_business_id, 'Food & Drinks',  '#37B24D', 'fast-food'),
    (p_business_id, 'Electronics',    '#F59F00', 'phone-portrait'),
    (p_business_id, 'Clothing',       '#E64980', 'shirt'),
    (p_business_id, 'Health & Beauty','#7950F2', 'heart');
end;
$$;

create or replace function public.get_business_payment_settings_summary()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.business_payment_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_permission('manage_payments') then
    raise exception 'You do not have permission to manage payments';
  end if;

  select *
  into v_settings
  from public.business_payment_settings
  where business_id = public.my_business_id();

  if not found then
    return json_build_object(
      'success', true,
      'configured', false,
      'provider', 'mpesa',
      'is_enabled', false,
      'environment', 'sandbox',
      'till_type', 'paybill',
      'shortcode', null,
      'account_reference', null,
      'has_consumer_key', false,
      'has_consumer_secret', false,
      'has_passkey', false,
      'last_test_status', null,
      'updated_at', null
    );
  end if;

  return json_build_object(
    'success', true,
    'configured', true,
    'provider', v_settings.provider,
    'is_enabled', v_settings.is_enabled,
    'environment', v_settings.environment,
    'till_type', v_settings.till_type,
    'shortcode', v_settings.shortcode,
    'account_reference', v_settings.account_reference,
    'has_consumer_key', nullif(trim(coalesce(v_settings.consumer_key, '')), '') is not null,
    'has_consumer_secret', nullif(trim(coalesce(v_settings.consumer_secret, '')), '') is not null,
    'has_passkey', nullif(trim(coalesce(v_settings.passkey, '')), '') is not null,
    'last_test_status', v_settings.last_test_status,
    'updated_at', v_settings.updated_at
  );
end;
$$;

create or replace function public.get_mpesa_checkout_status()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.business_payment_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_permission('create_sale') and not public.has_permission('manage_payments') then
    raise exception 'You do not have permission to use checkout';
  end if;

  select *
  into v_settings
  from public.business_payment_settings
  where business_id = public.my_business_id()
    and provider = 'mpesa';

  if not found then
    return json_build_object(
      'configured', false,
      'enabled', false,
      'environment', 'sandbox',
      'till_type', 'paybill',
      'account_reference', null,
      'shortcode_hint', null
    );
  end if;

  return json_build_object(
    'configured', true,
    'enabled', coalesce(v_settings.is_enabled, false),
    'environment', v_settings.environment,
    'till_type', v_settings.till_type,
    'account_reference', nullif(trim(coalesce(v_settings.account_reference, '')), ''),
    'shortcode_hint',
      case
        when nullif(trim(coalesce(v_settings.shortcode, '')), '') is null then null
        when length(trim(v_settings.shortcode)) <= 2 then repeat('*', length(trim(v_settings.shortcode)))
        else left(trim(v_settings.shortcode), 2) || repeat('*', greatest(length(trim(v_settings.shortcode)) - 2, 3))
      end
  );
end;
$$;

create or replace function public.upsert_business_payment_settings(
  p_is_enabled boolean default false,
  p_environment text default 'sandbox',
  p_till_type text default 'paybill',
  p_shortcode text default null,
  p_consumer_key text default null,
  p_consumer_secret text default null,
  p_passkey text default null,
  p_account_reference text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := public.my_business_id();
  v_existing public.business_payment_settings%rowtype;
  v_shortcode text := nullif(trim(coalesce(p_shortcode, '')), '');
  v_consumer_key text := nullif(trim(coalesce(p_consumer_key, '')), '');
  v_consumer_secret text := nullif(trim(coalesce(p_consumer_secret, '')), '');
  v_passkey text := nullif(trim(coalesce(p_passkey, '')), '');
  v_account_reference text := nullif(trim(coalesce(p_account_reference, '')), '');
  v_environment text := lower(trim(coalesce(p_environment, 'sandbox')));
  v_till_type text := lower(trim(coalesce(p_till_type, 'paybill')));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_business_id is null then
    raise exception 'No business account found for this user';
  end if;

  if not public.has_permission('manage_payments') then
    raise exception 'You do not have permission to manage payments';
  end if;

  if v_environment not in ('sandbox', 'live') then
    raise exception 'Environment must be sandbox or live';
  end if;

  if v_till_type not in ('paybill', 'till') then
    raise exception 'Till type must be paybill or till';
  end if;

  select *
  into v_existing
  from public.business_payment_settings
  where business_id = v_business_id
  for update;

  if found then
    update public.business_payment_settings
    set is_enabled = coalesce(p_is_enabled, false),
        environment = v_environment,
        till_type = v_till_type,
        shortcode = coalesce(v_shortcode, v_existing.shortcode),
        consumer_key = coalesce(v_consumer_key, v_existing.consumer_key),
        consumer_secret = coalesce(v_consumer_secret, v_existing.consumer_secret),
        passkey = coalesce(v_passkey, v_existing.passkey),
        account_reference = coalesce(v_account_reference, v_existing.account_reference),
        updated_at = now()
    where business_id = v_business_id
    returning * into v_existing;
  else
    insert into public.business_payment_settings(
      business_id,
      provider,
      is_enabled,
      environment,
      till_type,
      shortcode,
      consumer_key,
      consumer_secret,
      passkey,
      account_reference
    ) values (
      v_business_id,
      'mpesa',
      coalesce(p_is_enabled, false),
      v_environment,
      v_till_type,
      v_shortcode,
      v_consumer_key,
      v_consumer_secret,
      v_passkey,
      v_account_reference
    )
    returning * into v_existing;
  end if;

  if v_existing.is_enabled
     and (
       nullif(trim(coalesce(v_existing.shortcode, '')), '') is null
       or nullif(trim(coalesce(v_existing.consumer_key, '')), '') is null
       or nullif(trim(coalesce(v_existing.consumer_secret, '')), '') is null
       or nullif(trim(coalesce(v_existing.passkey, '')), '') is null
     ) then
    raise exception 'Complete shortcode, consumer key, consumer secret, and passkey before enabling M-Pesa';
  end if;

  return public.get_business_payment_settings_summary();
end;
$$;

create or replace function public.generate_client_access_token(
  p_admin_email text default null,
  p_business_name text default null,
  p_notes text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_token_id uuid;
  v_expires_at timestamptz := now() + interval '30 days';
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only the super admin can generate client access tokens';
  end if;

  loop
    v_token := 'BFLW-' ||
      upper(substr(replace(uuid_generate_v4()::text, '-', ''), 1, 6)) || '-' ||
      upper(substr(replace(uuid_generate_v4()::text, '-', ''), 7, 6));
    exit when not exists (
      select 1 from public.client_access_tokens where token = v_token
    );
  end loop;

  insert into public.client_access_tokens(
    token,
    admin_email,
    business_name,
    notes,
    status,
    created_by,
    expires_at
  ) values (
    v_token,
    nullif(trim(coalesce(p_admin_email, '')), ''),
    nullif(trim(coalesce(p_business_name, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'active',
    auth.uid(),
    v_expires_at
  )
  returning id into v_token_id;

  return json_build_object(
    'success', true,
    'id', v_token_id,
    'token', v_token,
    'expires_at', v_expires_at,
    'admin_email', nullif(trim(coalesce(p_admin_email, '')), ''),
    'business_name', nullif(trim(coalesce(p_business_name, '')), '')
  );
end;
$$;

create or replace function public.verify_client_access_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_record public.client_access_tokens%rowtype;
begin
  select *
  into v_token_record
  from public.client_access_tokens
  where token = trim(coalesce(p_token, ''))
  for update;

  if not found then
    return json_build_object(
      'success', false,
      'error', 'Token not found'
    );
  end if;

  if v_token_record.status = 'revoked' then
    return json_build_object(
      'success', false,
      'error', 'Token has been revoked'
    );
  end if;

  if v_token_record.status = 'used' or v_token_record.used_at is not null then
    return json_build_object(
      'success', false,
      'error', 'Token has already been used'
    );
  end if;

  if v_token_record.expires_at <= now() then
    update public.client_access_tokens
    set status = 'expired'
    where id = v_token_record.id;

    return json_build_object(
      'success', false,
      'error', 'Token has expired'
    );
  end if;

  return json_build_object(
    'success', true,
    'token', v_token_record.token,
    'admin_email', v_token_record.admin_email,
    'business_name', v_token_record.business_name,
    'expires_at', v_token_record.expires_at
  );
end;
$$;

create or replace function public.register_admin_with_access_token(
  p_token text,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_business_name text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_record public.client_access_tokens%rowtype;
  v_business_id uuid;
  v_admin_role_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_business_name text := trim(coalesce(p_business_name, ''));
begin
  if p_user_id is null then
    raise exception 'User ID is required';
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'You can only finish registration for your own account';
  end if;

  if v_email = '' then
    raise exception 'Email is required';
  end if;

  if v_full_name = '' then
    raise exception 'Full name is required';
  end if;

  select *
  into v_token_record
  from public.client_access_tokens
  where token = trim(coalesce(p_token, ''))
  for update;

  if not found then
    raise exception 'Token not found';
  end if;

  if v_token_record.status <> 'active' then
    raise exception 'Token is not active';
  end if;

  if v_token_record.used_at is not null then
    raise exception 'Token has already been used';
  end if;

  if v_token_record.expires_at <= now() then
    update public.client_access_tokens
    set status = 'expired'
    where id = v_token_record.id;
    raise exception 'Token has expired';
  end if;

  if v_token_record.admin_email is not null and lower(v_token_record.admin_email) <> v_email then
    raise exception 'This token is locked to %', v_token_record.admin_email;
  end if;

  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'This account has already been registered';
  end if;

  if v_business_name = '' then
    v_business_name := trim(coalesce(v_token_record.business_name, ''));
  end if;

  if v_business_name = '' then
    raise exception 'Business name is required';
  end if;

  insert into public.businesses(
    name,
    display_name,
    email,
    status,
    owner_name,
    owner_email,
    owner_user_id,
    created_by
  ) values (
    v_business_name,
    v_business_name,
    v_email,
    'active',
    v_full_name,
    v_email,
    p_user_id,
    v_token_record.created_by
  )
  returning id into v_business_id;

  v_admin_role_id := public.create_default_roles(v_business_id);

  insert into public.profiles(
    id,
    business_id,
    role_id,
    email,
    full_name,
    status,
    is_super_admin
  ) values (
    p_user_id,
    v_business_id,
    v_admin_role_id,
    v_email,
    v_full_name,
    'active',
    false
  );

  perform public.create_default_categories(v_business_id);

  update public.client_access_tokens
  set status = 'used',
      used_by = p_user_id,
      used_business_id = v_business_id,
      used_at = now()
  where id = v_token_record.id;

  return json_build_object(
    'success', true,
    'business_id', v_business_id,
    'role_id', v_admin_role_id
  );
end;
$$;

create or replace function public.promote_super_admin(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_email text;
begin
  if current_setting('request.jwt.claim.role', true) is not null and not public.is_super_admin() then
    return json_build_object(
      'success', false,
      'error', 'Only SQL editor or an existing super admin can promote accounts'
    );
  end if;

  select lower(trim(coalesce(email, '')))
  into v_target_email
  from public.profiles
  where id = p_user_id;

  if v_target_email is null then
    return json_build_object(
      'success', false,
      'error', 'Profile not found'
    );
  end if;

  if v_target_email <> public.super_admin_email() then
    return json_build_object(
      'success', false,
      'error', 'Only revivalthuranira@gmail.com can be promoted to super admin'
    );
  end if;

  update public.profiles
  set is_super_admin = false
  where is_super_admin = true
    and id <> p_user_id;

  update public.profiles
  set is_super_admin = true
  where id = p_user_id;

  if not found then
    return json_build_object(
      'success', false,
      'error', 'Profile not found'
    );
  end if;

  return json_build_object(
    'success', true,
    'user_id', p_user_id
  );
end;
$$;

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
alter table public.businesses       enable row level security;
alter table public.roles            enable row level security;
alter table public.profiles         enable row level security;
alter table public.invitations      enable row level security;
alter table public.client_access_tokens enable row level security;
alter table public.business_payment_settings enable row level security;
alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.sales            enable row level security;
alter table public.payment_intents  enable row level security;
alter table public.sale_items       enable row level security;
alter table public.expenses         enable row level security;
alter table public.notifications    enable row level security;

-- Drop any existing policies to avoid conflicts
do $$ declare r record;
begin
  for r in (select policyname, tablename from pg_policies where schemaname = 'public') loop
    execute 'drop policy if exists "' || r.policyname || '" on public.' || r.tablename;
  end loop;
end $$;

-- BUSINESSES
create policy "businesses_select" on public.businesses
  for select using (id = public.my_business_id() or public.is_super_admin());

create policy "businesses_update" on public.businesses
  for update using (
    (id = public.my_business_id() and public.my_role() = 'admin')
    or public.is_super_admin()
  );

-- ROLES
create policy "roles_select" on public.roles
  for select using (business_id = public.my_business_id());

-- PROFILES
create policy "profiles_select" on public.profiles
  for select using (business_id = public.my_business_id());

create policy "profiles_insert" on public.profiles
  for insert with check (true);

create policy "profiles_update" on public.profiles
  for update using (id = auth.uid() or
    (business_id = public.my_business_id() and public.my_role() = 'admin'));

-- INVITATIONS (open select so unauth users can verify tokens)
create policy "invitations_select_all" on public.invitations
  for select using (true);

create policy "invitations_insert" on public.invitations
  for insert with check (
    business_id = public.my_business_id()
    and public.has_permission('invite_staff')
  );

create policy "invitations_update" on public.invitations
  for update using (true);

-- CLIENT ACCESS TOKENS
create policy "client_access_tokens_select" on public.client_access_tokens
  for select using (public.is_super_admin());

create policy "client_access_tokens_update" on public.client_access_tokens
  for update using (public.is_super_admin());

-- BUSINESS PAYMENT SETTINGS
create policy "business_payment_settings_select" on public.business_payment_settings
  for select using (
    business_id = public.my_business_id()
    and public.has_permission('manage_payments')
  );

create policy "business_payment_settings_insert" on public.business_payment_settings
  for insert with check (
    business_id = public.my_business_id()
    and public.has_permission('manage_payments')
  );

create policy "business_payment_settings_update" on public.business_payment_settings
  for update using (
    business_id = public.my_business_id()
    and public.has_permission('manage_payments')
  );

-- CATEGORIES
create policy "categories_select" on public.categories
  for select using (business_id = public.my_business_id());

create policy "categories_insert" on public.categories
  for insert with check (
    business_id = public.my_business_id()
    and public.has_permission('manage_categories')
  );

create policy "categories_update" on public.categories
  for update using (
    business_id = public.my_business_id()
    and public.has_permission('manage_categories')
  );

create policy "categories_delete" on public.categories
  for delete using (
    business_id = public.my_business_id()
    and public.has_permission('manage_categories')
  );

-- PRODUCTS
create policy "products_select" on public.products
  for select using (business_id = public.my_business_id());

create policy "products_insert" on public.products
  for insert with check (
    business_id = public.my_business_id()
    and public.has_permission('add_stock')
  );

create policy "products_update" on public.products
  for update using (
    business_id = public.my_business_id()
    and (public.has_permission('edit_stock') or public.has_permission('create_sale'))
  );

create policy "products_delete" on public.products
  for delete using (
    business_id = public.my_business_id()
    and public.has_permission('delete_stock')
  );

-- STOCK MOVEMENTS
create policy "stock_movements_select" on public.stock_movements
  for select using (business_id = public.my_business_id());

create policy "stock_movements_insert" on public.stock_movements
  for insert with check (business_id = public.my_business_id());

-- SALES
create policy "sales_select" on public.sales
  for select using (
    business_id = public.my_business_id()
    and public.has_permission('view_sales')
  );

create policy "sales_insert" on public.sales
  for insert with check (
    business_id = public.my_business_id()
    and public.has_permission('create_sale')
  );

create policy "sales_update" on public.sales
  for update using (business_id = public.my_business_id());

-- PAYMENT INTENTS
create policy "payment_intents_select" on public.payment_intents
  for select using (
    business_id = public.my_business_id()
    and public.has_permission('view_sales')
  );

-- SALE ITEMS
create policy "sale_items_select" on public.sale_items
  for select using (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and s.business_id = public.my_business_id()
        and public.has_permission('view_sales')
    )
  );

create policy "sale_items_insert" on public.sale_items
  for insert with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_id
        and s.business_id = public.my_business_id()
    )
  );

-- EXPENSES
create policy "expenses_select" on public.expenses
  for select using (
    business_id = public.my_business_id()
    and public.has_permission('view_profits')
  );

create policy "expenses_all" on public.expenses
  for all using (
    business_id = public.my_business_id()
    and public.has_permission('view_profits')
  );

-- NOTIFICATIONS
create policy "notifications_select" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications_update" on public.notifications
  for update using (user_id = auth.uid());

create policy "notifications_insert" on public.notifications
  for insert with check (business_id = public.my_business_id());

-- ============================================================
-- 6. TRIGGERS
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists set_updated_at_businesses on public.businesses;
create trigger set_updated_at_businesses
  before update on public.businesses
  for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_business_payment_settings on public.business_payment_settings;
create trigger set_updated_at_business_payment_settings
  before update on public.business_payment_settings
  for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_products on public.products;
create trigger set_updated_at_products
  before update on public.products
  for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_profiles on public.profiles;
create trigger set_updated_at_profiles
  before update on public.profiles
  for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_payment_intents on public.payment_intents;
create trigger set_updated_at_payment_intents
  before update on public.payment_intents
  for each row execute function public.handle_updated_at();

-- Low stock alert trigger
create or replace function public.check_low_stock()
returns trigger language plpgsql as $$
begin
  if new.quantity <= new.reorder_level and old.quantity > old.reorder_level then
    insert into public.notifications(business_id, type, title, message, data)
    values (
      new.business_id, 'low_stock',
      'Low Stock Alert',
      new.name || ' is low: ' || new.quantity || ' ' || new.unit || ' remaining',
      jsonb_build_object('product_id', new.id, 'product_name', new.name, 'quantity', new.quantity)
    );
  end if;
  return new;
end; $$;

drop trigger if exists trigger_low_stock on public.products;
create trigger trigger_low_stock
  after update on public.products
  for each row execute function public.check_low_stock();

-- ============================================================
-- 7. ATOMIC SALES AND VOIDS
-- ============================================================

create or replace function public.process_sale(
  p_business_id       uuid,
  p_reference_number  text,
  p_sold_by           uuid,
  p_customer_name     text,
  p_customer_phone    text,
  p_total_amount      numeric,
  p_cost_total        numeric,
  p_profit            numeric,
  p_payment_method    text,
  p_amount_tendered   numeric,
  p_change_given      numeric,
  p_notes             text,
  p_items             jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id        uuid;
  v_item           jsonb;
  v_product        record;
  v_product_id     uuid;
  v_quantity       integer;
  v_items_count    integer := 0;
  v_unit_price     numeric := 0;
  v_cost_price     numeric := 0;
  v_total_price    numeric := 0;
  v_profit         numeric := 0;
  v_discount       numeric := 0;
  v_product_name   text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_sold_by is distinct from auth.uid() then
    raise exception 'You can only create sales as the signed-in user';
  end if;

  if p_business_id is distinct from public.my_business_id() then
    raise exception 'Sale business does not match your account';
  end if;

  if not public.has_permission('create_sale') then
    raise exception 'You do not have permission to create sales';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Sale must include at least one item';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Sale must include at least one item';
  end if;

  select coalesce(sum(coalesce((item->>'quantity')::integer, 0)), 0)
  into v_items_count
  from jsonb_array_elements(p_items) item;

  if v_items_count <= 0 then
    raise exception 'Sale items must have a positive quantity';
  end if;

  begin
    insert into public.sales(
      business_id,
      reference_number,
      sold_by,
      customer_name,
      customer_phone,
      total_amount,
      cost_total,
      profit,
      payment_method,
      amount_tendered,
      change_given,
      status,
      items_count,
      notes
    ) values (
      p_business_id,
      p_reference_number,
      p_sold_by,
      nullif(trim(coalesce(p_customer_name, '')), ''),
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      coalesce(p_total_amount, 0),
      coalesce(p_cost_total, 0),
      coalesce(p_profit, 0),
      coalesce(p_payment_method, 'cash'),
      coalesce(p_amount_tendered, 0),
      coalesce(p_change_given, 0),
      'completed',
      v_items_count,
      nullif(trim(coalesce(p_notes, '')), '')
    )
    returning id into v_sale_id;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := coalesce((v_item->>'quantity')::integer, 0);
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_cost_price := coalesce((v_item->>'cost_price')::numeric, 0);
      v_total_price := coalesce((v_item->>'total_price')::numeric, v_unit_price * v_quantity);
      v_profit := coalesce((v_item->>'profit')::numeric, v_total_price - (v_cost_price * v_quantity));
      v_discount := coalesce((v_item->>'discount')::numeric, 0);

      if v_quantity <= 0 then
        raise exception 'Invalid quantity for sale item';
      end if;

      select id, business_id, name, quantity
      into v_product
      from public.products
      where id = v_product_id
        and business_id = p_business_id
        and is_active = true
      for update;

      if not found then
        raise exception 'Product not found or inactive';
      end if;

      if v_product.quantity < v_quantity then
        raise exception 'Insufficient stock for product %. Available: %, Requested: %',
          v_product.name, v_product.quantity, v_quantity;
      end if;

      v_product_name := coalesce(nullif(trim(v_item->>'product_name'), ''), v_product.name);

      update public.products
      set quantity = v_product.quantity - v_quantity
      where id = v_product.id;

      insert into public.sale_items(
        sale_id,
        product_id,
        product_name,
        quantity,
        unit_price,
        cost_price,
        total_price,
        profit,
        discount
      ) values (
        v_sale_id,
        v_product.id,
        v_product_name,
        v_quantity,
        v_unit_price,
        v_cost_price,
        v_total_price,
        v_profit,
        v_discount
      );

      insert into public.stock_movements(
        product_id,
        business_id,
        type,
        quantity,
        reference,
        performed_by,
        notes
      ) values (
        v_product.id,
        p_business_id,
        'sale',
        -v_quantity,
        p_reference_number,
        p_sold_by,
        'Sale: ' || p_reference_number
      );
    end loop;

    return json_build_object(
      'success', true,
      'sale_id', v_sale_id,
      'reference_number', p_reference_number
    );
  exception when others then
    return json_build_object(
      'success', false,
      'error', SQLERRM
    );
  end;
end;
$$;

create or replace function public.void_sale_atomic(
  p_sale_id       uuid,
  p_voided_by     uuid,
  p_void_reason   text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale           public.sales%rowtype;
  v_item           public.sale_items%rowtype;
  v_product_qty    integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_voided_by is distinct from auth.uid() then
    raise exception 'You can only void sales as the signed-in user';
  end if;

  if not public.has_permission('void_sale') then
    raise exception 'You do not have permission to void sales';
  end if;

  begin
    select *
    into v_sale
    from public.sales
    where id = p_sale_id
      and business_id = public.my_business_id()
    for update;

    if not found then
      raise exception 'Sale not found';
    end if;

    if v_sale.status <> 'completed' then
      raise exception 'Can only void completed sales. Current status: %', v_sale.status;
    end if;

    update public.sales
    set status = 'voided',
        voided_by = p_voided_by,
        voided_at = now(),
        void_reason = nullif(trim(coalesce(p_void_reason, '')), '')
    where id = p_sale_id;

    for v_item in
      select *
      from public.sale_items
      where sale_id = p_sale_id
      order by created_at asc
    loop
      select quantity
      into v_product_qty
      from public.products
      where id = v_item.product_id
        and business_id = v_sale.business_id
      for update;

      if not found then
        raise exception 'Product for sale item no longer exists';
      end if;

      update public.products
      set quantity = v_product_qty + v_item.quantity
      where id = v_item.product_id;

      insert into public.stock_movements(
        product_id,
        business_id,
        type,
        quantity,
        reference,
        performed_by,
        notes
      ) values (
        v_item.product_id,
        v_sale.business_id,
        'void',
        v_item.quantity,
        v_sale.reference_number,
        p_voided_by,
        case
          when nullif(trim(coalesce(p_void_reason, '')), '') is null then 'Void: ' || v_sale.reference_number
          else 'Void: ' || v_sale.reference_number || ' - ' || trim(p_void_reason)
        end
      );
    end loop;

    return json_build_object(
      'success', true,
      'sale_id', p_sale_id,
      'message', 'Sale voided and stock restored'
    );
  exception when others then
    return json_build_object(
      'success', false,
      'error', SQLERRM
    );
  end;
end;
$$;

create or replace function public.complete_mpesa_sale_from_intent(
  p_intent_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent          public.payment_intents%rowtype;
  v_sale_id         uuid;
  v_item            jsonb;
  v_product         record;
  v_product_id      uuid;
  v_quantity        integer;
  v_items_count     integer := 0;
  v_unit_price      numeric := 0;
  v_cost_price      numeric := 0;
  v_total_price     numeric := 0;
  v_profit_value    numeric := 0;
  v_discount        numeric := 0;
  v_product_name    text;
  v_payment_note    text;
  v_created_by      uuid;
begin
  select *
  into v_intent
  from public.payment_intents
  where id = p_intent_id
  for update;

  if not found then
    return json_build_object(
      'success', false,
      'error', 'Payment intent not found'
    );
  end if;

  if v_intent.sale_id is not null then
    return json_build_object(
      'success', true,
      'sale_id', v_intent.sale_id,
      'message', 'Sale already completed'
    );
  end if;

  if v_intent.status not in ('paid', 'completed') then
    return json_build_object(
      'success', false,
      'error', 'Payment is not ready for completion'
    );
  end if;

  if v_intent.items_payload is null or jsonb_typeof(v_intent.items_payload) <> 'array' or jsonb_array_length(v_intent.items_payload) = 0 then
    return json_build_object(
      'success', false,
      'error', 'Payment intent has no sale items'
    );
  end if;

  select coalesce(sum(coalesce((item->>'quantity')::integer, 0)), 0)
  into v_items_count
  from jsonb_array_elements(v_intent.items_payload) item;

  if v_items_count <= 0 then
    return json_build_object(
      'success', false,
      'error', 'Payment intent items have invalid quantities'
    );
  end if;

  v_created_by := coalesce((v_intent.sale_payload->>'sold_by')::uuid, v_intent.created_by);
  v_payment_note := nullif(trim(coalesce(v_intent.sale_payload->>'notes', '')), '');

  if nullif(trim(coalesce(v_intent.mpesa_receipt_number, '')), '') is not null then
    v_payment_note := concat_ws(' | ', v_payment_note, 'M-Pesa receipt: ' || trim(v_intent.mpesa_receipt_number));
  end if;

  begin
    insert into public.sales(
      business_id,
      reference_number,
      sold_by,
      customer_name,
      customer_phone,
      total_amount,
      cost_total,
      profit,
      payment_method,
      amount_tendered,
      change_given,
      status,
      items_count,
      notes
    ) values (
      v_intent.business_id,
      v_intent.reference_number,
      v_created_by,
      nullif(trim(coalesce(v_intent.customer_name, v_intent.sale_payload->>'customer_name', '')), ''),
      nullif(trim(coalesce(v_intent.customer_phone, '')), ''),
      coalesce(v_intent.amount, 0),
      coalesce((v_intent.sale_payload->>'cost_total')::numeric, 0),
      coalesce((v_intent.sale_payload->>'profit')::numeric, 0),
      'mpesa',
      coalesce(v_intent.amount, 0),
      0,
      'completed',
      v_items_count,
      v_payment_note
    )
    returning id into v_sale_id;

    for v_item in select * from jsonb_array_elements(v_intent.items_payload)
    loop
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := coalesce((v_item->>'quantity')::integer, 0);
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_cost_price := coalesce((v_item->>'cost_price')::numeric, 0);
      v_total_price := coalesce((v_item->>'total_price')::numeric, v_unit_price * v_quantity);
      v_profit_value := coalesce((v_item->>'profit')::numeric, v_total_price - (v_cost_price * v_quantity));
      v_discount := coalesce((v_item->>'discount')::numeric, 0);

      if v_quantity <= 0 then
        raise exception 'Invalid quantity for sale item';
      end if;

      select id, business_id, name, quantity
      into v_product
      from public.products
      where id = v_product_id
        and business_id = v_intent.business_id
        and is_active = true
      for update;

      if not found then
        raise exception 'Product not found or inactive';
      end if;

      if v_product.quantity < v_quantity then
        raise exception 'Insufficient stock for product %. Available: %, Requested: %',
          v_product.name, v_product.quantity, v_quantity;
      end if;

      v_product_name := coalesce(nullif(trim(v_item->>'product_name'), ''), v_product.name);

      update public.products
      set quantity = v_product.quantity - v_quantity
      where id = v_product.id;

      insert into public.sale_items(
        sale_id,
        product_id,
        product_name,
        quantity,
        unit_price,
        cost_price,
        total_price,
        profit,
        discount
      ) values (
        v_sale_id,
        v_product.id,
        v_product_name,
        v_quantity,
        v_unit_price,
        v_cost_price,
        v_total_price,
        v_profit_value,
        v_discount
      );

      insert into public.stock_movements(
        product_id,
        business_id,
        type,
        quantity,
        reference,
        performed_by,
        notes
      ) values (
        v_product.id,
        v_intent.business_id,
        'sale',
        -v_quantity,
        v_intent.reference_number,
        v_created_by,
        'M-Pesa sale: ' || v_intent.reference_number
      );
    end loop;

    update public.payment_intents
    set sale_id = v_sale_id,
        status = 'completed',
        completed_at = now(),
        error_message = null
    where id = v_intent.id;

    return json_build_object(
      'success', true,
      'sale_id', v_sale_id,
      'reference_number', v_intent.reference_number
    );
  exception when others then
    update public.payment_intents
    set error_message = SQLERRM,
        updated_at = now()
    where id = v_intent.id;

    insert into public.notifications(
      business_id,
      user_id,
      type,
      title,
      message,
      data
    ) values (
      v_intent.business_id,
      v_intent.created_by,
      'payment_review',
      'M-Pesa payment needs review',
      'Payment for ' || v_intent.reference_number || ' was received, but BizFlow could not complete the sale automatically.',
      jsonb_build_object(
        'payment_intent_id', v_intent.id,
        'reference_number', v_intent.reference_number,
        'error', SQLERRM,
        'status', v_intent.status
      )
    );

    return json_build_object(
      'success', false,
      'error', SQLERRM,
      'status', v_intent.status
    );
  end;
end;
$$;

grant execute on function public.process_sale(uuid, text, uuid, text, text, numeric, numeric, numeric, text, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.void_sale_atomic(uuid, uuid, text) to authenticated;
grant execute on function public.get_business_payment_settings_summary() to authenticated;
grant execute on function public.get_mpesa_checkout_status() to authenticated;
grant execute on function public.upsert_business_payment_settings(boolean, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.complete_mpesa_sale_from_intent(uuid) to service_role;

-- ============================================================
-- 8. REALTIME PUBLICATION
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'businesses'
    ) then
      alter publication supabase_realtime add table public.businesses;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'roles'
    ) then
      alter publication supabase_realtime add table public.roles;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invitations'
    ) then
      alter publication supabase_realtime add table public.invitations;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
    ) then
      alter publication supabase_realtime add table public.categories;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
    ) then
      alter publication supabase_realtime add table public.products;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_movements'
    ) then
      alter publication supabase_realtime add table public.stock_movements;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales'
    ) then
      alter publication supabase_realtime add table public.sales;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sale_items'
    ) then
      alter publication supabase_realtime add table public.sale_items;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_access_tokens'
    ) then
      alter publication supabase_realtime add table public.client_access_tokens;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'business_payment_settings'
    ) then
      alter publication supabase_realtime add table public.business_payment_settings;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_intents'
    ) then
      alter publication supabase_realtime add table public.payment_intents;
    end if;
  end if;
end $$;

-- ============================================================
-- 9. BOOTSTRAP FUNCTION
-- Run this manually ONCE after your first admin signup
-- ============================================================

create or replace function public.bootstrap_admin(
  p_user_id    uuid,
  p_email      text,
  p_full_name  text,
  p_biz_name   text default 'My Business'
)
returns json language plpgsql security definer as $$
declare
  v_biz_id   uuid;
  v_role_id  uuid;
begin
  if current_setting('request.jwt.claim.role', true) is not null and not public.is_super_admin() then
    return json_build_object('error', 'Only SQL editor or super admin can run bootstrap_admin');
  end if;

  -- Guard: don't run if user already has a profile
  if exists (select 1 from public.profiles where id = p_user_id) then
    return json_build_object('error', 'User already bootstrapped');
  end if;

  -- Create business
  insert into public.businesses(name, display_name, email, status, owner_name, owner_email, owner_user_id, created_by)
  values (p_biz_name, p_biz_name, p_email, 'active', p_full_name, p_email, p_user_id, p_user_id)
  returning id into v_biz_id;

  v_role_id := public.create_default_roles(v_biz_id);

  -- Admin profile
  insert into public.profiles(id, business_id, role_id, email, full_name, status, is_super_admin)
  values (p_user_id, v_biz_id, v_role_id, p_email, p_full_name, 'active', false);

  -- Default categories
  perform public.create_default_categories(v_biz_id);

  return json_build_object(
    'success', true,
    'business_id', v_biz_id,
    'role_id', v_role_id
  );
end; $$;

-- ============================================================
-- 10. GRANT PERMISSIONS
-- ============================================================
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
revoke execute on function public.create_default_roles(uuid) from anon, authenticated;
revoke execute on function public.create_default_categories(uuid) from anon, authenticated;
revoke execute on function public.bootstrap_admin(uuid, text, text, text) from anon, authenticated;
revoke execute on function public.promote_super_admin(uuid) from anon, authenticated;
revoke execute on function public.complete_mpesa_sale_from_intent(uuid) from anon, authenticated;
grant execute on function public.register_admin_with_access_token(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.verify_client_access_token(text) to anon, authenticated;
grant execute on function public.generate_client_access_token(text, text, text) to authenticated;

-- ============================================================
-- ALL DONE. Next: follow the setup guide.
-- ============================================================
