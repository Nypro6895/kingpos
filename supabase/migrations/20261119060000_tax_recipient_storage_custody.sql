begin;

-- Delivered Tax documents freeze the personal recipient independently of later
-- employment, account links, plugin access and the Owner's document tombstone.
-- Preserve the earlier financial restriction for every other caller/object.
-- ALTER POLICY retains its restrictive SELECT/TO authenticated identity.
alter policy financial_paystub_object_read_limit on storage.objects
using (
  storage.objects.bucket_id <> 'payroll-paystubs'
  or public.financial_paystub_object_in_scope(storage.objects.name)
  or exists (
    select 1
    from public.tax_documents as delivered
    where delivered.bucket = storage.objects.bucket_id
      and delivered.path = storage.objects.name
      and delivered.recipient_user_id = public.current_public_user_id()
      and public.tax_document_access(delivered.id)
  )
);

notify pgrst, 'reload schema';
commit;
