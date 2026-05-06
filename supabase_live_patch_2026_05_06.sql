alter table public.sales add column if not exists payment_payer_name text;
alter table public.sales add column if not exists payment_reference text;
alter table public.sales add column if not exists payment_message text;

alter table public.billing_plans alter column currency set default 'KES';
alter table public.billing_checkouts alter column currency set default 'KES';

insert into public.billing_plans (
  slug,
  name,
  description,
  amount_minor,
  currency,
  billing_days,
  features,
  is_trial,
  is_lifetime,
  is_active,
  sort_order
)
values
  (
    'free-trial',
    'Free Trial',
    'Automatic 7-day trial for every new business that signs up.',
    0,
    'KES',
    7,
    '["7 staff onboarding slots","Desktop web access","Offline sales and reports","Upgrade later from inside the app"]'::jsonb,
    true,
    false,
    true,
    0
  ),
  (
    'beta',
    'Beta',
    'Monthly BizFlow access after the free trial ends.',
    90000,
    'KES',
    30,
    '["7 staff onboarding slots","Desktop web access","Offline sales and reports","No CSV export"]'::jsonb,
    false,
    false,
    true,
    10
  ),
  (
    'lifetime',
    'Lifetime',
    'One-time BizFlow purchase for permanent business access.',
    1290000,
    'KES',
    36500,
    '["Unlimited staff onboarding","CSV exports","Barcode scanner","Desktop web access","Offline sales and reports"]'::jsonb,
    false,
    true,
    true,
    20
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  amount_minor = excluded.amount_minor,
  currency = excluded.currency,
  billing_days = excluded.billing_days,
  features = excluded.features,
  is_trial = excluded.is_trial,
  is_lifetime = excluded.is_lifetime,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.billing_plans
set is_active = false,
    updated_at = now()
where slug in ('starter', 'growth', 'scale');

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
  p_items             jsonb,
  p_payment_reference text default null,
  p_payment_payer_name text default null,
  p_payment_message   text default null
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

  if not public.business_subscription_is_active(p_business_id) then
    raise exception 'This business subscription is not active. Renew billing before creating new sales.';
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
      payment_payer_name,
      payment_reference,
      payment_message,
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
      nullif(trim(coalesce(p_payment_payer_name, '')), ''),
      nullif(trim(coalesce(p_payment_reference, '')), ''),
      nullif(trim(coalesce(p_payment_message, '')), ''),
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

create or replace function public.complete_mpesa_sale_from_intent(
  p_intent_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent            public.payment_intents%rowtype;
  v_sale_id           uuid;
  v_item              jsonb;
  v_product           record;
  v_product_id        uuid;
  v_quantity          integer;
  v_items_count       integer := 0;
  v_unit_price        numeric := 0;
  v_cost_price        numeric := 0;
  v_total_price       numeric := 0;
  v_profit_value      numeric := 0;
  v_discount          numeric := 0;
  v_product_name      text;
  v_payment_note      text;
  v_created_by        uuid;
  v_payment_reference text;
  v_payment_payer_name text;
  v_payment_message   text;
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
  v_payment_reference := coalesce(
    nullif(trim(coalesce(v_intent.sale_payload->>'payment_reference', '')), ''),
    nullif(trim(coalesce(v_intent.mpesa_receipt_number, '')), '')
  );
  v_payment_payer_name := nullif(trim(coalesce(v_intent.sale_payload->>'payment_payer_name', '')), '');
  v_payment_message := nullif(trim(coalesce(v_intent.sale_payload->>'payment_message', '')), '');

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
      payment_payer_name,
      payment_reference,
      payment_message,
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
      nullif(trim(coalesce(v_intent.customer_name, v_intent.sale_payload->>'customer_name', v_payment_payer_name, '')), ''),
      nullif(trim(coalesce(v_intent.customer_phone, '')), ''),
      v_payment_payer_name,
      v_payment_reference,
      v_payment_message,
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

grant execute on function public.process_sale(uuid, text, uuid, text, text, numeric, numeric, numeric, text, numeric, numeric, text, jsonb, text, text, text) to authenticated;
