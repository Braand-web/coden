-- One number per version within a project.
--
-- The next number used to be computed by counting the project's stored
-- versions, so two runs finishing together could both write "version 4" and a
-- restore could not tell them apart. The unique index makes the second insert
-- fail and the writer read the number again.
create unique index if not exists project_versions_project_number_uniq
  on public.project_versions (project_id, version_number);
