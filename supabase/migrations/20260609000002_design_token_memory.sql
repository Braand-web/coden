-- Design Token Memory — extends project_memory with design_token type
-- Allows Coden to persist the visual design system (colors, fonts, radii,
-- spacing) per project so UI is visually consistent across generations.

-- The project_memory table already exists (20260609000001).
-- We only need to ensure the CHECK constraint allows the new type.
-- Supabase doesn't support ALTER CHECK directly, so we use a trigger approach.

-- Add design_token as an accepted memory_type by recreating the check constraint.
-- Safe to run multiple times (idempotent DROP CONSTRAINT IF EXISTS).

DO $$
BEGIN
  -- Drop old constraint if it still has the old allowed values
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'project_memory'
      AND constraint_name = 'project_memory_memory_type_check'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.project_memory
      DROP CONSTRAINT project_memory_memory_type_check;
  END IF;

  -- Re-add with design_token included
  ALTER TABLE public.project_memory
    ADD CONSTRAINT project_memory_memory_type_check
    CHECK (memory_type IN ('adr', 'preference', 'blocker', 'pattern', 'design_token'));
END
$$;

-- Index for fast design token lookups
CREATE INDEX IF NOT EXISTS project_memory_design_token_idx
  ON public.project_memory (project_id, memory_type)
  WHERE memory_type = 'design_token';

COMMENT ON COLUMN public.project_memory.memory_type IS
  'adr=architecture decision, preference=user preference, blocker=known failure, '
  'pattern=code pattern, design_token=extracted visual design system (colors/fonts/radii)';
