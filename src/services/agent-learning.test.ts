import { describe, expect, it } from 'vitest';
import {
  anonymizeText,
  contributorHash,
  CURATED_KNOWLEDGE,
  errorFixKnowledge,
  errorSignature,
  isPublicPackage,
  learnedPreference,
  rankKnowledge,
  renderUserMemory,
  stackFromPackageJson,
  stackPatternKnowledge,
  styleMemoryFromFeedback,
  type KnowledgeRow,
} from './agent-learning';

describe('anonymisation', () => {
  it('removes secrets, e-mails, URLs, ids, paths and private literals', () => {
    const raw = 'Failed at /home/awa/acme-crm/src/pages/Clients.tsx:12:4 for jean.dupont@acme.fr with key sk-live_abcdefghijklmnopqrstuvwxyz0123456789 at https://acme.supabase.co/rest/v1?apikey=xyz id 123e4567-e89b-12d3-a456-426614174000 and "Acme Holding SARL"';
    const clean = anonymizeText(raw);
    for (const leak of ['awa', 'acme-crm', 'jean.dupont', 'acme.fr', 'sk-live', 'supabase.co', '123e4567', 'Acme Holding']) expect(clean).not.toContain(leak);
    expect(clean).toContain('<file.tsx>');
    expect(clean).toContain('<email>');
  });

  it('keeps package names, which are the useful part of an import error', () => {
    expect(anonymizeText('Failed to resolve import "react-router-dom" from "src/App.tsx"')).toContain("'react-router-dom'");
    expect(isPublicPackage('@supabase/supabase-js')).toBe(true);
    expect(isPublicPackage('@acme-internal/ui')).toBe(false);
  });

  it('gives the same error one signature whatever the file and line', () => {
    const a = errorSignature('src/pages/A.tsx(12,4): error TS2304: Cannot find name \'useState\'.');
    const b = errorSignature('src/components/B.tsx(88,10): error TS2304: Cannot find name \'useState\'.');
    expect(a).toBe(b);
  });
});

describe('knowledge', () => {
  const salt = 'test-salt';
  const alice = contributorHash('alice', salt);
  const bob = contributorHash('bob', salt);

  it('builds error-fix rows from resolved problems, never from user text', () => {
    const rows = errorFixKnowledge([{ message: 'Failed to resolve import "recharts" from "src/Dashboard.tsx"', source: 'dev_server', missingPackage: 'recharts', file: 'src/Dashboard.tsx' }], 'code_generation', alice);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('install_package');
    expect(rows[0].content).not.toContain('Dashboard');
    expect(rows[0].contributor).toBe(alice);
    expect(alice).not.toContain('alice');
  });

  it('only surfaces a learned pattern once two different people produced it', () => {
    const row = errorFixKnowledge([{ message: 'Cannot find name useState', source: 'typecheck' }], 'code_edit', alice)[0];
    const one = rankKnowledge([row], 'erreur cannot find name useState');
    expect(one).toHaveLength(0);
    const two = rankKnowledge([row, { ...row, contributor: bob }], 'erreur cannot find name useState');
    expect(two).toHaveLength(1);
    expect(two[0].contributors).toBe(2);
  });

  it('serves curated knowledge to a brand-new account', () => {
    const ranked = rankKnowledge(CURATED_KNOWLEDGE, 'fix failed to resolve import react-router-dom');
    expect(ranked[0].content).toContain('install_package');
  });

  it('keeps only public packages in a stack pattern', () => {
    const stack = stackFromPackageJson(JSON.stringify({ dependencies: { react: '19', 'react-router-dom': '7', recharts: '2', '@acme-internal/ui': '1', '@supabase/supabase-js': '2' } }));
    expect(stack).toEqual(['@supabase/supabase-js', 'react-router-dom', 'recharts']);
    const pattern = stackPatternKnowledge('saas', 'code_generation', stack, alice) as KnowledgeRow;
    expect(pattern.content).toContain('recharts');
  });
});

describe('private memory', () => {
  it('turns feedback reasons into style notes and renders them', () => {
    const rows = styleMemoryFromFeedback(['too_long', 'unknown_reason']);
    expect(rows).toHaveLength(1);
    const block = renderUserMemory([...rows, { key: 'language', kind: 'language', content: 'français', weight: 3 }, { key: 'stack:tailwindcss', kind: 'stack', content: 'tailwindcss', weight: 4 }]);
    expect(block).toContain('français');
    expect(block).toContain('tailwindcss');
    expect(block).toContain('plus courtes');
  });
});

describe('routing', () => {
  const eligible = ['cheap/model', 'mid/model', 'strong/model'];
  it('keeps the default while evidence is thin', () => {
    expect(learnedPreference(eligible, 'code_generation', [{ task_type: 'code_generation', model_id: 'mid/model', runs: 50, successes: 49 }])).toEqual({ modelId: 'cheap/model', learned: false });
  });

  it('prefers a model that measurably succeeds more often on this task', () => {
    const stats = [
      { task_type: 'code_generation', model_id: 'cheap/model', runs: 40, successes: 18 },
      { task_type: 'code_generation', model_id: 'mid/model', runs: 30, successes: 27 },
    ];
    expect(learnedPreference(eligible, 'code_generation', stats)).toEqual({ modelId: 'mid/model', learned: true });
    expect(learnedPreference(eligible, 'code_edit', stats)).toEqual({ modelId: 'cheap/model', learned: false });
  });

  it('does not switch for a marginal difference', () => {
    const stats = [
      { task_type: 'code_generation', model_id: 'cheap/model', runs: 40, successes: 33 },
      { task_type: 'code_generation', model_id: 'mid/model', runs: 40, successes: 35 },
    ];
    expect(learnedPreference(eligible, 'code_generation', stats)?.learned).toBe(false);
  });
});
