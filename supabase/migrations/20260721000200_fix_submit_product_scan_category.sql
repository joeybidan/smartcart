-- Forward fix for submit_product_scan category qualification and blank categories.
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
  clean_category text := coalesce(nullif(trim(submit_product_scan.category), ''), 'Uncategorized');
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

  if nullif(trim(name), '') is null or nullif(trim(retailer), '') is null or nullif(trim(branch), '') is null then
    raise exception using errcode = '22023', message = 'Name, retailer, and branch are required';
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
      clean_category, nullif(trim(submit_product_scan.size), ''),
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
        category = case when nullif(trim(existing_product.category), '') is not null then existing_product.category else clean_category end,
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
