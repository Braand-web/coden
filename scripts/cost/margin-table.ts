// Prints the margin tables of docs/audit-couts-2026-10.md from the public price list and the measured run costs.
// Run: node --experimental-strip-types scripts/cost/margin-table.ts
import { DEFAULT_ASSUMPTIONS, actionMargin, maxProviderCostUsd, sensitivity } from '../../src/services/margin-model.ts';

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(0)} %`);
const usd = (value: number) => `${value.toFixed(3)} $`;

// Measured provider cost per run, purchase fee included (usage_events, category build, 28 runs, 2026-09-08 → 2026-10-01).
const runs = [
  { route: 'Petite modification (small_edit)', action: 'component' as const, cost: 0.0137, n: 8 },
  { route: 'Grosse modification (large_change)', action: 'feature' as const, cost: 0.0424, n: 9 },
  { route: 'Nouveau projet (new_project)', action: 'full_page' as const, cost: 0.1064, n: 11 },
];
// Estimated: a run on a premium model (5 $/25 $ per million, ~1,6 M input tokens, 92 % cached, ~20 k output).
const premium = { route: 'Run premium estimé (Opus/Fable), page complète', action: 'full_page' as const, cost: 1.9, n: 0 };

const plans = [
  { plan: 'pro' as const, credits: 25, label: 'Pro 25' },
  { plan: 'pro' as const, credits: 100, label: 'Pro 100' },
  { plan: 'business' as const, credits: 100, label: 'Business 100' },
];

console.log('| Type de run (coût mesuré, n) | Crédits | ' + plans.map(p => p.label).join(' | ') + ' |');
console.log('|---|---|' + plans.map(() => '---').join('|') + '|');
for (const run of [...runs, premium]) {
  const cells = plans.map(p => {
    const margin = actionMargin({ plan: p.plan, credits: p.credits, interval: 'monthly', action: run.action, providerCostUsd: run.cost });
    return `${pct(margin.marginPct)} (${margin.verdict === 'loss' ? 'perte' : usd(margin.marginUsd)})`;
  });
  console.log(`| ${run.route} : ${usd(run.cost)}${run.n ? `, n=${run.n}` : ', estimé'} | ${actionMargin({ plan: 'pro', credits: 100, interval: 'monthly', action: run.action, providerCostUsd: 0 }).credits} | ${cells.join(' | ')} |`);
}

console.log('\nCoût maximal d\'un run pour garder le plancher de 55 % (hypothèses par défaut) :\n');
console.log('| Action | ' + plans.map(p => p.label).join(' | ') + ' |');
console.log('|---|' + plans.map(() => '---').join('|') + '|');
for (const action of ['targeted_style', 'component', 'plan', 'feature', 'full_page'] as const) {
  console.log(`| ${action} | ${plans.map(p => usd(maxProviderCostUsd({ plan: p.plan, credits: p.credits, interval: 'monthly', action }))).join(' | ')} |`);
}

console.log('\nSensibilité (Pro 100, page complète, run mesuré à 0,106 $) :\n');
console.log('| Scénario | Marge |\n|---|---|');
for (const row of sensitivity({ plan: 'pro', credits: 100, interval: 'monthly', action: 'full_page', providerCostUsd: 0.1064 })) console.log(`| ${row.label} | ${pct(row.marginPct)} |`);

console.log('\nHypothèses :', JSON.stringify(DEFAULT_ASSUMPTIONS));
