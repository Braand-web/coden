export type CodenCloudBackendMode = 'shared' | 'dedicated';

export type CodenCloudRequirement = {
  needs_database: boolean;
  needs_auth: boolean;
  needs_storage: boolean;
  needs_edge_functions: boolean;
  needs_secrets: boolean;
  detected_from_prompt: string[];
  recommended_mode: CodenCloudBackendMode;
  summary: string;
};

const BACKEND_SIGNAL_PATTERNS: Array<{
  key: keyof Pick<
    CodenCloudRequirement,
    'needs_database' | 'needs_auth' | 'needs_storage' | 'needs_edge_functions' | 'needs_secrets'
  >;
  label: string;
  patterns: RegExp[];
}> = [
  {
    key: 'needs_auth',
    label: 'auth',
    patterns: [
      /\b(auth|authentication|login|log in|logout|sign in|sign up|signup|session|password|oauth|google sign[- ]?in)\b/i,
      /\b(user accounts?|members?|roles?|permissions?|profiles?)\b/i,
      /\b(marketplace|crm|vendors?|buyers?|sellers?)\b/i,
      /\b(connexion|connecter|inscription|mot de passe|utilisateurs?|membres?|rôles?|roles?)\b/i,
    ],
  },
  {
    key: 'needs_database',
    label: 'database',
    patterns: [
      /\b(database|db|data model|schema|migration|crud|records?|tables?)\b/i,
      /\b(clients?|customers?|orders?|products?|invoices?|bookings?|reservations?|messages?|notes?|tasks?|deals?|leads?|vendors?|reviews?)\b/i,
      /\b(crm|marketplace|inventory|catalog|dashboard admin|restaurant reservations?)\b/i,
      /\b(base de donn[ée]es|donn[ée]es|tables?|clients?|commandes?|produits?|factures?|r[ée]servations?|messages?|notes?|t[âa]ches?)\b/i,
    ],
  },
  {
    key: 'needs_storage',
    label: 'storage',
    patterns: [
      /\b(upload|uploads?|file upload|files?|images?|photos?|avatars?|pdfs?|documents?|media|storage|bucket)\b/i,
      /\b(t[ée]l[ée]verser|fichiers?|images?|photos?|avatar|pdf|documents?|stockage|m[ée]dia)\b/i,
    ],
  },
  {
    key: 'needs_edge_functions',
    label: 'edge_functions',
    patterns: [
      /\b(webhooks?|stripe|email|emails?|scheduled jobs?|cron|background jobs?|ai jobs?|serverless|edge functions?|api callback|callback url)\b/i,
      /\b(webhooks?|paiement|emails?|t[âa]che planifi[ée]e|cron|fonction backend|fonction serverless|callback)\b/i,
    ],
  },
  {
    key: 'needs_secrets',
    label: 'secrets',
    patterns: [
      /\b(api keys?|private keys?|secret keys?|webhook secret|token|stripe secret|resend|openai|twilio|google maps|sendgrid)\b/i,
      /\b(cl[ée] api|cl[ée] priv[ée]e|secret|jeton|token|identifiants? priv[ée]s?)\b/i,
    ],
  },
];

const DEDICATED_BACKEND_PATTERNS = [
  /\b(dedicated|isolated|enterprise|business|pro plan|custom backend|own database|separate supabase|high isolation|compliance)\b/i,
  /\b(d[ée]di[ée]|isol[ée]|entreprise|professionnel|backend priv[ée]|base s[ée]par[ée]e|conformit[ée])\b/i,
];

export function detectCodenCloudRequirements(prompt: string): CodenCloudRequirement {
  const text = String(prompt || '').trim();
  const detected = new Set<string>();
  const requirement: CodenCloudRequirement = {
    needs_database: false,
    needs_auth: false,
    needs_storage: false,
    needs_edge_functions: false,
    needs_secrets: false,
    detected_from_prompt: [],
    recommended_mode: DEDICATED_BACKEND_PATTERNS.some(pattern => pattern.test(text)) ? 'dedicated' : 'shared',
    summary: 'No managed backend required.',
  };

  for (const signal of BACKEND_SIGNAL_PATTERNS) {
    if (signal.patterns.some(pattern => pattern.test(text))) {
      requirement[signal.key] = true;
      detected.add(signal.label);
    }
  }

  requirement.detected_from_prompt = Array.from(detected);
  const needsBackend = hasCodenCloudRequirement(requirement);
  if (needsBackend) {
    const parts = [
      requirement.needs_auth ? 'auth' : '',
      requirement.needs_database ? 'database' : '',
      requirement.needs_storage ? 'storage' : '',
      requirement.needs_edge_functions ? 'edge functions' : '',
      requirement.needs_secrets ? 'secrets' : '',
    ].filter(Boolean);
    requirement.summary = `Coden Cloud should manage ${parts.join(', ')} for this project.`;
  }

  return requirement;
}

export function hasCodenCloudRequirement(requirement: Pick<
  CodenCloudRequirement,
  'needs_database' | 'needs_auth' | 'needs_storage' | 'needs_edge_functions' | 'needs_secrets'
>) {
  return Boolean(
    requirement.needs_database ||
    requirement.needs_auth ||
    requirement.needs_storage ||
    requirement.needs_edge_functions ||
    requirement.needs_secrets
  );
}

export function buildCodenCloudSchemaName(projectId: string) {
  const safe = String(projectId || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `app_${safe || 'project'}`;
}

export function summarizeCodenCloudRequirements(requirement: CodenCloudRequirement) {
  if (!hasCodenCloudRequirement(requirement)) return 'No Coden Cloud backend needed yet.';
  return `${requirement.summary} Recommended mode: ${requirement.recommended_mode}.`;
}
