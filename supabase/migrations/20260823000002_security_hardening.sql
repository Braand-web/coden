-- Harden service-only functions after provisioning the Coden control plane.

alter function public.process_credit_transaction(uuid, numeric, text, text, text)
  set search_path = public, pg_temp;
alter function public.set_updated_at()
  set search_path = public, pg_temp;
alter function public.cleanup_expired_jobs()
  set search_path = public, pg_temp;
alter function public.debit_cloud_balance(uuid, numeric, text, numeric, text, text, text, uuid)
  set search_path = public, pg_temp;
alter function public.reactivate_cloud_wallet(uuid)
  set search_path = public, pg_temp;
alter function public.collect_app_schema_bytes()
  set search_path = public, pg_temp;
alter function public.claim_due_coden_workflows(text, integer)
  set search_path = public, pg_temp;
alter function public.rls_auto_enable()
  set search_path = public, pg_temp;

revoke execute on function public.process_credit_transaction(uuid, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_jobs() from public, anon, authenticated;
revoke execute on function public.debit_cloud_balance(uuid, numeric, text, numeric, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.reactivate_cloud_wallet(uuid) from public, anon, authenticated;
revoke execute on function public.claim_due_coden_workflows(text, integer) from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

grant execute on function public.process_credit_transaction(uuid, numeric, text, text, text) to service_role;
grant execute on function public.cleanup_expired_jobs() to service_role;
grant execute on function public.debit_cloud_balance(uuid, numeric, text, numeric, text, text, text, uuid) to service_role;
grant execute on function public.reactivate_cloud_wallet(uuid) to service_role;
grant execute on function public.claim_due_coden_workflows(text, integer) to service_role;
grant execute on function public.rls_auto_enable() to service_role;

