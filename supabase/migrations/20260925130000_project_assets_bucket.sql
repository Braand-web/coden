-- Coden Cloud storage: the bucket every project's files go to.
--
-- The console and the API have always written to "project-assets", and the
-- bucket was never created, so every import failed. Private: files are read
-- through short-lived signed URLs issued by the server for the project's own
-- members, never through a public link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets',
  'project-assets',
  false,
  4194304,
  array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','text/plain','text/markdown','application/json','text/csv','application/pdf','application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
