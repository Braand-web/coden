export type UniversalProductContract = {
  goal: string;
  productShape: string;
  capabilities: string[];
  entities: string[];
  roles: string[];
  workflows: string[];
  integrations: string[];
  dataPolicy: {
    persistence: 'none' | 'local_requested' | 'managed_backend';
    allowUserFacingFixtures: false;
    emptyStateRequired: true;
  };
  acceptanceCriteria: string[];
};

const SIGNALS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\b(auth|login|signup|session|account|member|role)\b/i, value: 'authentication and protected access' },
  { pattern: /\b(database|data|crud|supabase|postgres|sql|persist)\b/i, value: 'persistent data workflows' },
  { pattern: /\b(payment|stripe|checkout|billing|subscription|invoice)\b/i, value: 'secure payment or billing workflow' },
  { pattern: /\b(upload|file|files|fichier|fichiers|image|video|vidéo|audio|storage|stockage|attachment|pièce jointe)\b/i, value: 'file and media handling' },
  { pattern: /\b(search|filter|sort|find)\b/i, value: 'search, filtering, and result states' },
  { pattern: /\b(admin|dashboard|analytics|report|metric)\b/i, value: 'operational administration and reporting' },
  { pattern: /\b(realtime|live|notification|chat|message)\b/i, value: 'live updates and communication' },
  { pattern: /\b(api|integration|webhook|external)\b/i, value: 'external integration contract' },
];

function unique(values: string[]) {
  return values.filter((value, index, list) => value && list.indexOf(value) === index);
}

function extractNamedSignals(prompt: string, pattern: RegExp) {
  return unique(Array.from(prompt.matchAll(pattern), match => String(match[1] || '').trim()).filter(Boolean)).slice(0, 12);
}

export function buildUniversalProductContract(prompt: string): UniversalProductContract {
  const cleanPrompt = String(prompt || '').replace(/\s+/g, ' ').trim();
  const capabilities = unique(SIGNALS.filter(signal => signal.pattern.test(cleanPrompt)).map(signal => signal.value));
  const explicitlyLocal = /\b(localstorage|local storage|stockage local|offline only|sans backend)\b/i.test(cleanPrompt);
  const needsBackend = capabilities.some(item => /persistent|authentication|payment|file|live|external/i.test(item));

  return {
    goal: cleanPrompt || 'Build the product requested by the user.',
    productShape: 'Infer the product structure freely from the complete request; do not force a predefined app category.',
    capabilities,
    entities: extractNamedSignals(cleanPrompt, /\b(?:manage|g[eé]rer|track|suivre|create|cr[eé]er)\s+(?:des?|les?|a|an)?\s*([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9 _-]{2,32})/gi),
    roles: extractNamedSignals(cleanPrompt, /\b(?:for|pour|role|r[oô]le)\s+(?:des?|les?|a|an)?\s*([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9 _-]{2,24})/gi),
    workflows: capabilities.length ? capabilities.map(item => `Complete the ${item} end to end.`) : ['Complete the primary user workflow end to end.'],
    integrations: unique([
      /\bsupabase\b/i.test(cleanPrompt) ? 'Supabase/Coden Cloud' : '',
      /\bstripe\b/i.test(cleanPrompt) ? 'Stripe' : '',
      /\b(api|webhook|integration)\b/i.test(cleanPrompt) ? 'Requested external services' : '',
    ]),
    dataPolicy: {
      persistence: explicitlyLocal ? 'local_requested' : needsBackend ? 'managed_backend' : 'none',
      allowUserFacingFixtures: false,
      emptyStateRequired: true,
    },
    acceptanceCriteria: [
      'The primary workflow works visibly from start to finish.',
      'Every visible primary control has a real interaction or an honest unavailable state.',
      'No invented users, products, metrics, transactions, or success states appear in the user-facing app.',
      'Empty, loading, error, and success states exist where the workflow needs them.',
      'The app renders responsively without a blank preview or runtime crash.',
    ],
  };
}

export function universalProductContractPromptContext(contract: UniversalProductContract) {
  return [
    'Universal product contract (binding):',
    'Infer the application freely from the full request. Predefined blueprints are optional engineering references, never product-shape constraints.',
    'Do not add features merely because they exist in a known category. Do not omit requested features because the category is unknown.',
    'Never invent user-facing data. Use honest empty states until the user creates data or a real backend returns it.',
    JSON.stringify(contract),
  ].join('\n');
}
