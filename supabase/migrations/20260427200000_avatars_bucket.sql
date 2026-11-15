-- Storage bucket dla zdjęć pracowników (avatary).
-- Public read (avatar widoczny na publicznej stronie biura).
-- Path: {user_id}/{timestamp}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read (bucket public=true uruchamia to przez signed URL, ale dodajemy policy dla pewności)
create policy "avatars_public_read"
on storage.objects for select
to public
using (bucket_id = 'avatars');

-- User może uploadowac do własnego folderu (path[0] = jego user_id)
create policy "avatars_upload_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Posel może zarządzać dowolnym avatarem (admin edycja pracowników)
create policy "avatars_upload_posel"
on storage.objects for insert
to authenticated
with check (bucket_id = 'avatars' and public.is_posel());

create policy "avatars_update_posel"
on storage.objects for update
to authenticated
using (bucket_id = 'avatars' and public.is_posel());

create policy "avatars_delete_posel"
on storage.objects for delete
to authenticated
using (bucket_id = 'avatars' and public.is_posel());
