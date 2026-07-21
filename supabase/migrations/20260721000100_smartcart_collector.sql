create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'contributor',
  created_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('admin', 'contributor'))
);

create table if not exists public.products (
  barcode text primary key,
  name text not null,
  brand text,
  category text not null,
  size text,
  unit text,
  last_price numeric(12, 2),
  last_retailer text,
  last_branch text,
  last_price_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_barcode_check check (barcode ~ '^[0-9]+$' and length(barcode) in (8, 12, 13, 14)),
  constraint products_price_check check (last_price is null or last_price > 0)
);

create table if not exists public.price_observations (
  id uuid primary key default gen_random_uuid(),
  barcode text not null references public.products(barcode) on delete cascade,
  price numeric(12, 2) not null,
  retailer text not null,
  branch text not null,
  captured_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  source text not null default 'scanner',
  created_at timestamptz not null default now(),
  constraint price_observations_price_check check (price > 0)
);

create index if not exists products_created_by_idx on public.products (created_by);
create index if not exists products_updated_at_idx on public.products (updated_at desc);
create index if not exists price_observations_barcode_captured_at_idx
  on public.price_observations (barcode, captured_at desc);
create index if not exists price_observations_created_by_idx on public.price_observations (created_by);
create index if not exists price_observations_retailer_idx on public.price_observations (retailer);
create index if not exists price_observations_branch_idx on public.price_observations (branch);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.submit_product_scan(
  barcode text,
  name text,
  brand text,
  category text,
  size text,
  unit text,
  price numeric,
  retailer text,
  branch text,
  captured_at timestamptz,
  source text,
  local_id text default null
)
returns table (product_id text, price_observation_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  observation_id uuid;
  existing_product public.products%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if barcode is null or barcode !~ '^[0-9]+$' or length(barcode) not in (8, 12, 13, 14) then
    raise exception using errcode = '22023', message = 'Barcode must contain 8, 12, 13, or 14 digits';
  end if;

  if price is null or price <= 0 then
    raise exception using errcode = '22023', message = 'Price must be greater than zero';
  end if;

  if nullif(trim(name), '') is null or nullif(trim(category), '') is null
     or nullif(trim(retailer), '') is null or nullif(trim(branch), '') is null then
    raise exception using errcode = '22023', message = 'Name, category, retailer, and branch are required';
  end if;

  if local_id is not null and local_id <> '' then
    observation_id := md5(local_id)::uuid;
  else
    observation_id := gen_random_uuid();
  end if;

  select * into existing_product
  from public.products
  where products.barcode = submit_product_scan.barcode
  for update;

  if not found then
    insert into public.products (
      barcode, name, brand, category, size, unit, last_price,
      last_retailer, last_branch, last_price_at, created_by
    ) values (
      submit_product_scan.barcode, trim(submit_product_scan.name), nullif(trim(submit_product_scan.brand), ''),
      trim(submit_product_scan.category), nullif(trim(submit_product_scan.size), ''),
      nullif(trim(submit_product_scan.unit), ''), submit_product_scan.price,
      trim(submit_product_scan.retailer), trim(submit_product_scan.branch),
      coalesce(submit_product_scan.captured_at, now()), current_user_id
    );
  else
    update public.products
    set last_price = submit_product_scan.price,
        last_retailer = trim(submit_product_scan.retailer),
        last_branch = trim(submit_product_scan.branch),
        last_price_at = coalesce(submit_product_scan.captured_at, now()),
        updated_at = now(),
        name = case when nullif(trim(existing_product.name), '') is not null then existing_product.name else trim(submit_product_scan.name) end,
        brand = coalesce(existing_product.brand, nullif(trim(submit_product_scan.brand), '')),
        category = case when nullif(trim(existing_product.category), '') is not null then existing_product.category else trim(submit_product.category) end,
        size = coalesce(existing_product.size, nullif(trim(submit_product_scan.size), '')),
        unit = coalesce(existing_product.unit, nullif(trim(submit_product_scan.unit), ''))
    where products.barcode = submit_product_scan.barcode;
  end if;

  insert into public.price_observations (
    id, barcode, price, retailer, branch, captured_at, created_by, source
  ) values (
    observation_id, submit_product_scan.barcode, submit_product_scan.price,
    trim(submit_product_scan.retailer), trim(submit_product_scan.branch),
    coalesce(submit_product_scan.captured_at, now()), current_user_id,
    coalesce(nullif(trim(submit_product_scan.source), ''), 'scanner')
  ) on conflict (id) do nothing;

  product_id := submit_product_scan.barcode;
  price_observation_id := observation_id;
  return next;
end;
$$;

revoke all on function public.submit_product_scan(text, text, text, text, text, text, numeric, text, text, timestamptz, text, text) from public;
grant execute on function public.submit_product_scan(text, text, text, text, text, text, numeric, text, text, timestamptz, text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.price_observations enable row level security;

drop policy if exists "profiles_read_own" on public.profiles;
create policy "profiles_read_own" on public.profiles
for select to authenticated using ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "profiles_update_own_display_name" on public.profiles;
create policy "profiles_update_own_display_name" on public.profiles
for update to authenticated
using ((select auth.uid()) = id or (select public.is_admin()))
with check (
  (select public.is_admin())
  or ((select auth.uid()) = id and role = 'contributor')
);

drop policy if exists "products_read_authenticated" on public.products;
create policy "products_read_authenticated" on public.products
for select to authenticated using (true);

drop policy if exists "products_insert_owned" on public.products;
create policy "products_insert_owned" on public.products
for insert to authenticated with check ((select auth.uid()) = created_by);

drop policy if exists "products_admin_update" on public.products;
create policy "products_admin_update" on public.products
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "products_no_delete" on public.products;
create policy "products_no_delete" on public.products
for delete to authenticated using (false);

drop policy if exists "observations_read_authenticated" on public.price_observations;
create policy "observations_read_authenticated" on public.price_observations
for select to authenticated using (true);

drop policy if exists "observations_insert_owned" on public.price_observations;
create policy "observations_insert_owned" on public.price_observations
for insert to authenticated with check ((select auth.uid()) = created_by);

drop policy if exists "observations_update_own_or_admin" on public.price_observations;
create policy "observations_update_own_or_admin" on public.price_observations
for update to authenticated
using ((select auth.uid()) = created_by or (select public.is_admin()))
with check ((select auth.uid()) = created_by or (select public.is_admin()));

drop policy if exists "observations_delete_own_or_admin" on public.price_observations;
create policy "observations_delete_own_or_admin" on public.price_observations
for delete to authenticated
using ((select auth.uid()) = created_by or (select public.is_admin()));

grant usage on schema public to authenticated;
grant select on public.profiles, public.products, public.price_observations to authenticated;
revoke insert on public.products from authenticated;
grant insert on public.price_observations to authenticated;
grant update, delete on public.price_observations to authenticated;
grant update on public.profiles, public.products to authenticated;
