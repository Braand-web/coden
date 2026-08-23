do $$
begin
  if to_regclass('public.project_files') is not null then
    execute $sql$
      with ranked as (
        select
          ctid,
          row_number() over (
            partition by project_id, path
            order by updated_at desc nulls last, ctid desc
          ) as row_rank
        from public.project_files
      )
      delete from public.project_files files
      using ranked
      where files.ctid = ranked.ctid
        and ranked.row_rank > 1
    $sql$;

    execute 'create unique index if not exists project_files_project_path_unique_idx on public.project_files(project_id, path)';
  end if;
end $$;
