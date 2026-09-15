create or replace function public.limitless_launch_policy_commit(p_brand_id text, p_checkout_experience jsonb, p_metadata_key text, p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','limitless'
as $function$
declare v_data jsonb;
begin
  if p_metadata_key <> 'launch_policy_approval:' or (p_record->>'brandId') is distinct from p_brand_id then
    raise exception 'invalid_policy_record';
  end if;
  select data::jsonb into v_data from limitless.brands where id=p_brand_id for update;
  if v_data is null then raise exception 'brand_not_found'; end if;
  v_data := jsonb_set(v_data,'{checkoutExperience}',p_checkout_experience,true);
  update limitless.brands set data=v_data::text where id=p_brand_id;
  insert into limitless.metadata(key,value)
  values(p_metadata_key || p_brand_id,p_record::text)
  on conflict(key) do update set value=excluded.value;
  return v_data;
end;
$function$;

revoke all on function public.limitless_launch_policy_commit(text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.limitless_launch_policy_commit(text,jsonb,text,jsonb) to service_role;
