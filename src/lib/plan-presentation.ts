/**
 * Turn the structured response used by planning agents into a compact,
 * user-facing representation. The planning model may use either the current
 * planner contract (`summary` / `files` / `risks`) or the earlier product-plan
 * shape (`title` / `objective` / `features` / `architecture`). Keeping this
 * normalization here means neither response is ever rendered as raw JSON.
 */

export type PlanSectionId = 'features' | 'architecture' | 'steps' | 'files' | 'risks';

export type PlanPresentationSection = {
  id: PlanSectionId;
  items: string[];
};

export type PlanPresentation = {
  title: string;
  summary: string;
  sections: PlanPresentationSection[];
  /** The sanitized model payload, retained only for the explicit build action. */
  source: string;
};

const MAX_TITLE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 640;
const MAX_ITEM_LENGTH = 360;
const MAX_ITEMS_PER_SECTION = 8;

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function firstText(record: Record<string, unknown>, keys: string[], maxLength: number) {
  for (const key of keys) {
    const text = cleanText(record[key], maxLength);
    if (text) return text;
  }
  return '';
}

function itemText(value: unknown) {
  const direct = cleanText(value, MAX_ITEM_LENGTH);
  if (direct) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  const record = value as Record<string, unknown>;
  const path = cleanText(record.path ?? record.file, 180);
  const action = cleanText(record.action, 40);
  const rationale = firstText(record, ['rationale', 'description', 'summary', 'title', 'name'], 250);
  const label = [action, path].filter(Boolean).join(' · ');
  if (label && rationale) return `${label} — ${rationale}`.slice(0, MAX_ITEM_LENGTH);
  return (label || rationale).slice(0, MAX_ITEM_LENGTH);
}

function sectionItems(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    const items = values
      .map(itemText)
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, MAX_ITEMS_PER_SECTION);
    if (items.length) return items;
  }
  return [];
}

function parseObject(value: string): Record<string, unknown> | null {
  const unfenced = value
    .trim()
    .replace(/^```(?:json|javascript|typescript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!unfenced.startsWith('{') || !unfenced.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(unfenced);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Returns `null` for normal prose so regular assistant answers keep their
 * markdown rendering. Only an actual plan object gets the specialised card.
 */
export function parsePlanPresentation(value: unknown): PlanPresentation | null {
  const source = String(value ?? '').trim();
  if (!source || source.length > 80_000) return null;
  const record = parseObject(source);
  if (!record) return null;

  const sections: PlanPresentationSection[] = [
    { id: 'features' as PlanSectionId, items: sectionItems(record, ['features', 'capabilities', 'requirements']) },
    { id: 'architecture' as PlanSectionId, items: sectionItems(record, ['architecture', 'approach', 'technical_approach']) },
    { id: 'steps' as PlanSectionId, items: sectionItems(record, ['steps', 'milestones', 'implementation_steps']) },
    { id: 'files' as PlanSectionId, items: sectionItems(record, ['files', 'target_files', 'changes']) },
    { id: 'risks' as PlanSectionId, items: sectionItems(record, ['risks', 'blockers', 'assumptions']) },
  ].filter(section => section.items.length);

  const title = firstText(record, ['title', 'plan_title', 'name'], MAX_TITLE_LENGTH);
  const summary = firstText(record, ['summary', 'objective', 'description', 'goal'], MAX_SUMMARY_LENGTH);
  if (!title && !summary && !sections.length) return null;

  return {
    title: title || 'Plan',
    summary,
    sections,
    source,
  };
}
