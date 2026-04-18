-- ============================================================
-- BIZFLOW - COMPLETE SUPABASE SQL SETUP
-- Paste this ENTIRE file into Supabase SQL Editor and click Run
-- ============================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- ============================================================
-- 2. CORE TABLES
-- ============================================================

-- Businesses
create table if not exists public.businesses (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  email       text,
  phone       text,
  address     text,
  currency    text default 'GBP',
  logo_url    text,
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
  payment_method    text default 'cash' check (payment_method in ('cash','card','transfer','mixed')),
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
-- 3. INDEXES
-- ============================================================
create index if not exists idx_products_business    on public.products(business_id);
create index if not exists idx_sales_business       on public.sales(business_id);
create index if not exists idx_sales_created        on public.sales(created_at desc);
create index if not exists idx_sales_status         on public.sales(business_id, status);
create index if not exists idx_sale_items_sale      on public.sale_items(sale_id);
create index if not exists idx_stock_mov_product    on public.stock_movements(product_id);
create index if not exists idx_profiles_business    on public.profiles(business_id);
create index if not exists idx_invitations_token    on public.invitations(token);
create index if not exists idx_invitations_email    on public.invitations(email);

-- Align existing projects with the app defaults.
alter table public.businesses alter column currency set default 'KES';

do $$
begin
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
end $$;

-- ============================================================
-- 4. HELPER FUNCTIONS
-- ============================================================

create or replace function public.my_business_id()
returns uuid language sql stable security definer as $$
  select business_id from public.profiles where id = auth.uid()
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

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================
alter table public.businesses       enable row level security;
alter table public.roles            enable row level security;
alter table public.profiles         enable row level security;
alter table public.invitations      enable row level security;
alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.sales            enable row level security;
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
  for select using (id = public.my_business_id());

create policy "businesses_update" on public.businesses
  for update using (id = public.my_business_id() and public.my_role() = 'admin');

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

drop trigger if exists set_updated_at_products on public.products;
create trigger set_updated_at_products
  before update on public.products
  for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_profiles on public.profiles;
create trigger set_updated_at_profiles
  before update on public.profiles
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
-- 7. BOOTSTRAP FUNCTION
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
  -- Guard: don't run if user already has a profile
  if exists (select 1 from public.profiles where id = p_user_id) then
    return json_build_object('error', 'User already bootstrapped');
  end if;

  -- Create business
  insert into public.businesses(name, email)
  values (p_biz_name, p_email)
  returning id into v_biz_id;

  -- Admin role
  insert into public.roles(business_id, name, permissions) values (v_biz_id, 'admin',
    '{"view_dashboard":true,"view_sales":true,"create_sale":true,"void_sale":true,"view_stock":true,"add_stock":true,"edit_stock":true,"delete_stock":true,"view_reports":true,"export_reports":true,"manage_staff":true,"invite_staff":true,"view_profits":true,"manage_categories":true}'
  ) returning id into v_role_id;

  -- Sales Manager role
  insert into public.roles(business_id, name, permissions) values (v_biz_id, 'sales_manager',
    '{"view_dashboard":true,"view_sales":true,"create_sale":true,"void_sale":true,"view_stock":true,"add_stock":false,"edit_stock":false,"delete_stock":false,"view_reports":true,"export_reports":true,"manage_staff":false,"invite_staff":false,"view_profits":true,"manage_categories":false}'
  );

  -- Cashier role
  insert into public.roles(business_id, name, permissions) values (v_biz_id, 'cashier',
    '{"view_dashboard":true,"view_sales":true,"create_sale":true,"void_sale":false,"view_stock":true,"add_stock":false,"edit_stock":false,"delete_stock":false,"view_reports":false,"export_reports":false,"manage_staff":false,"invite_staff":false,"view_profits":false,"manage_categories":false}'
  );

  -- Stock Manager role
  insert into public.roles(business_id, name, permissions) values (v_biz_id, 'stock_manager',
    '{"view_dashboard":true,"view_sales":false,"create_sale":false,"void_sale":false,"view_stock":true,"add_stock":true,"edit_stock":true,"delete_stock":true,"view_reports":true,"export_reports":false,"manage_staff":false,"invite_staff":false,"view_profits":false,"manage_categories":true}'
  );

  -- Accountant role
  insert into public.roles(business_id, name, permissions) values (v_biz_id, 'accountant',
    '{"view_dashboard":true,"view_sales":true,"create_sale":false,"void_sale":false,"view_stock":true,"add_stock":false,"edit_stock":false,"delete_stock":false,"view_reports":true,"export_reports":true,"manage_staff":false,"invite_staff":false,"view_profits":true,"manage_categories":false}'
  );

  -- Admin profile
  insert into public.profiles(id, business_id, role_id, email, full_name, status)
  values (p_user_id, v_biz_id, v_role_id, p_email, p_full_name, 'active');

  -- Default categories
  insert into public.categories(business_id, name, color, icon) values
    (v_biz_id, 'General',        '#3B5BDB', 'grid'),
    (v_biz_id, 'Food & Drinks',  '#37B24D', 'fast-food'),
    (v_biz_id, 'Electronics',    '#F59F00', 'phone-portrait'),
    (v_biz_id, 'Clothing',       '#E64980', 'shirt'),
    (v_biz_id, 'Health & Beauty','#7950F2', 'heart');

  return json_build_object(
    'success', true,
    'business_id', v_biz_id,
    'role_id', v_role_id
  );
end; $$;

-- ============================================================
-- 8. GRANT PERMISSIONS
-- ============================================================
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- ============================================================
-- ALL DONE. Next: follow the setup guide.
-- ============================================================
