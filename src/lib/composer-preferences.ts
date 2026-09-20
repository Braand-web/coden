/*
 * What the composer remembers between mounts, surfaces and sessions.
 *
 * The model and the effort were each remembered in one place and read in
 * another. `model-selector-ui.ts` wrote `coden-selected-model`, the Builder
 * wrote it again under its own constant, and the React composer read neither:
 * it initialised its model to `models[0]` — Auto — every time it mounted. A
 * user who picked Sonnet got Auto back on the next render, which is the exact
 * opposite of the promise the selector makes.
 *
 * The effort had it worse: nothing persisted it at all.
 *
 * One module owns both keys so the three surfaces cannot drift again. Every
 * accessor is wrapped, because Safari private mode throws on `localStorage`
 * rather than returning null, and a composer that cannot render is a worse
 * failure than a preference that does not stick.
 */

import { normalizeModelSelectionId } from '../config/ai-models';
import { normalizeAgentEffort, type AgentEffort } from '../services/agent-effort';

export const SELECTED_MODEL_STORAGE_KEY = 'coden-selected-model';
export const SELECTED_EFFORT_STORAGE_KEY = 'coden-selected-effort';

function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is an optimisation. The workspace state remains authoritative.
  }
}

/** The model the user last chose, or `'auto'`. Never an id outside the catalogue. */
export function readPreferredModelSelection(): string {
  return normalizeModelSelectionId(readRaw(SELECTED_MODEL_STORAGE_KEY));
}

export function writePreferredModelSelection(value: unknown): string {
  const normalized = normalizeModelSelectionId(value);
  writeRaw(SELECTED_MODEL_STORAGE_KEY, normalized);
  return normalized;
}

/** The effort the user last chose, or the default level. */
export function readPreferredEffort(): AgentEffort {
  return normalizeAgentEffort(readRaw(SELECTED_EFFORT_STORAGE_KEY));
}

export function writePreferredEffort(value: unknown): AgentEffort {
  const normalized = normalizeAgentEffort(value);
  writeRaw(SELECTED_EFFORT_STORAGE_KEY, normalized);
  return normalized;
}
