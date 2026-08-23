/**
 * Meta-prompter — transforms raw user input into a structured technical specification
 * before it reaches the LLM generator. This improves generation quality by:
 * 1. Adding domain-specific requirements the user didn't think to specify
 * 2. Flagging known failure modes proactively
 * 3. Injecting production-readiness requirements based on app type
 */

type AppCategory =
  | 'ecommerce_marketplace'
  | 'saas_dashboard'
  | 'crm_sales'
  | 'social_community'
  | 'productivity_tool'
  | 'content_media'
  | 'fintech_billing'
  | 'healthcare_education'
  | 'landing_marketing'
  | 'ai_tool'
  | 'booking_calendar'
  | 'analytics_reporting'
  | 'generic';

function detectAppCategory(appType: string, prompt: string): AppCategory {
  const t = `${appType} ${prompt}`.toLowerCase();
  if (/ecommerce|marketplace|shop|cart|checkout|product|catalog|vendeur|boutique/.test(t)) return 'ecommerce_marketplace';
  if (/saas|dashboard|workspace|analytics|billing|subscription|tenant|organisation/.test(t)) return 'saas_dashboard';
  if (/crm|lead|pipeline|contact|deal|sales|client|prospect/.test(t)) return 'crm_sales';
  if (/social|feed|post|comment|like|follow|community|network|forum/.test(t)) return 'social_community';
  if (/todo|task|kanban|project management|board|sprint|backlog|trello|notion/.test(t)) return 'productivity_tool';
  if (/blog|cms|media|video|podcast|article|newsletter|editorial/.test(t)) return 'content_media';
  if (/fintech|payment|invoice|banking|wallet|transaction|stripe|billing/.test(t)) return 'fintech_billing';
  if (/health|medical|patient|doctor|education|course|learning|lms|quiz/.test(t)) return 'healthcare_education';
  if (/landing|homepage|hero|marketing|saas marketing|agency|agence/.test(t)) return 'landing_marketing';
  if (/ai tool|chatbot|prompt|generator|ai assistant|outil ia/.test(t)) return 'ai_tool';
  if (/booking|reservation|appointment|calendar|schedule|rendez-vous/.test(t)) return 'booking_calendar';
  if (/analytics|metrics|kpi|reporting|chart|graph|dashboard analytics/.test(t)) return 'analytics_reporting';
  return 'generic';
}

function getCategoryRequirements(category: AppCategory): string[] {
  switch (category) {
    case 'ecommerce_marketplace':
      return [
        'Include product catalog with search, filters (price, category, rating), and sort (newest, price asc/desc).',
        'Implement a persistent cart with add/remove/quantity controls and running total.',
        'Design checkout flow: cart review → shipping info → payment (Stripe-ready placeholder) → confirmation.',
        'Show no-results and empty-cart states with CTAs.',
        'Product cards must show image placeholder, name, price, rating, and add-to-cart button.',
        'Implement database schema with products, orders, order_items tables and RLS.',
      ];
    case 'saas_dashboard':
      return [
        'Design a sidebar navigation with collapsible sections and active-state indicators.',
        'Include metric cards with real-time value, trend arrow (up/down), and comparison period.',
        'Add a data table with sortable columns, pagination, row actions, and bulk-select.',
        'Implement workspace/tenant isolation — every query must be scoped by organization_id.',
        'Show skeleton loading states for all async data panels.',
        'Include a settings section with plan/billing display and profile management.',
      ];
    case 'crm_sales':
      return [
        'Design a pipeline board (Kanban) with drag-to-move cards between stages.',
        'Each lead/contact card shows name, company, value, next action, and last contacted date.',
        'Include a detail view/drawer with timeline of interactions, notes, and task list.',
        'Implement search and filter by stage, owner, value range, and date range.',
        'Add activity feed showing calls, emails, notes, and deal changes.',
        'Scope all data by user or team with proper RLS policies.',
      ];
    case 'social_community':
      return [
        'Implement an infinite-scroll feed with post cards showing avatar, username, timestamp, content, and engagement counts.',
        'Add like/comment/share actions with optimistic UI updates.',
        'Include a user profile page with bio, post history, follow counts, and follow/unfollow button.',
        'Design a notification system with unread badge and dropdown list.',
        'Implement real-time updates for likes and comments using Supabase Realtime or polling.',
        'Show a consistent empty state for new users with onboarding CTAs.',
      ];
    case 'productivity_tool':
      return [
        'Persist all items to localStorage (or Supabase if auth is requested) and restore on page reload.',
        'Implement keyboard shortcuts: Enter to add, Delete to remove, Space to toggle.',
        'Add bulk actions: select all, delete selected, complete selected.',
        'Include filter tabs: All / Active / Completed with item counts.',
        'Support inline editing of task titles with blur-to-save.',
        'Show a progress bar or counter indicating completion ratio.',
      ];
    case 'fintech_billing':
      return [
        'Use conservative, trust-building visual design: white/neutral surfaces, crisp typography, clear numbers.',
        'Show all amounts formatted as currency with locale-appropriate formatting.',
        'Include a transaction table with date, description, amount, status badge, and downloadable receipt link.',
        'Implement confirmation dialogs for all destructive or financial actions.',
        'Add input validation with decimal precision rules for amount fields.',
        'Never display internal cost breakdowns, margins, or supplier pricing to users.',
      ];
    case 'ai_tool':
      return [
        'Design a split-panel layout: prompt input on left/top, streaming output on right/bottom.',
        'Show a live streaming cursor animation during generation.',
        'Implement model selector with capability badges (fast, balanced, premium).',
        'Add history sidebar with recent prompts and outputs, filterable and searchable.',
        'Include copy-to-clipboard, download, and share actions on outputs.',
        'Display token count and estimated cost (in credits, not dollars) after each generation.',
        'Handle streaming errors gracefully with retry button and error message.',
      ];
    case 'booking_calendar':
      return [
        'Implement a calendar view (month/week toggle) showing available and booked slots.',
        'Design a booking flow: select date → pick time slot → enter contact info → confirmation.',
        'Show real-time slot availability with visual differentiation (available/booked/selected).',
        'Include a my-bookings page with cancel/reschedule actions.',
        'Send confirmation feedback (toast/banner) after booking with booking reference.',
        'Implement timezone display and handle edge cases (no slots available, past dates blocked).',
      ];
    case 'analytics_reporting':
      return [
        'Use Chart.js, Recharts, or SVG-based charts — no fake chart images.',
        'Include date range picker affecting all charts simultaneously.',
        'Show KPI cards with trend sparklines, change percentage, and comparison period.',
        'Implement chart type toggle (bar/line/area) where applicable.',
        'Add export to CSV functionality for tabular data.',
        'Ensure charts are responsive and accessible with aria-labels and color-blind-safe palettes.',
      ];
    case 'landing_marketing':
      return [
        'Structure: hero → social proof → features → how-it-works → pricing → FAQ → CTA footer.',
        'Hero must have a specific, benefit-driven headline (not vague "Build faster").',
        'Include 3–5 feature cards with icon, bold benefit headline, and 1-sentence description.',
        'Add a pricing section with plan comparison table and highlighted recommended plan.',
        'Implement smooth scroll navigation with active-section highlighting.',
        'Ensure above-the-fold content is fully visible on mobile without horizontal scroll.',
      ];
    case 'healthcare_education':
      return [
        'Use calm, high-readability typography (min 16px body, generous line-height 1.6+).',
        'Meet WCAG 2.1 AA contrast requirements across all text.',
        'Do not invent patient, student, progress, or medical records. Render an honest empty state until real data exists.',
        'Implement progress tracking for education apps (completion percentage, badges).',
        'Add accessible form controls with descriptive labels and error messages near fields.',
        'Never generate or suggest real medical advice, dosages, or diagnoses.',
      ];
    case 'content_media':
      return [
        'Design a card grid layout for content listing with featured post treatment.',
        'Include category/tag filters and search with debounced input.',
        'Implement a reading/article view with comfortable typography and estimated read time.',
        'Add bookmark/save-for-later functionality with local persistence.',
        'Design rich media embeds (image, video placeholder) with proper aspect ratios.',
        'Include sharing actions (copy link, social share) with native share API fallback.',
      ];
    default:
      return [
        'Ensure the app renders without a blank screen on first load.',
        'Implement visible loading, empty, and error states for all async operations.',
        'Make all interactive controls functional with clear visual feedback.',
        'Use consistent design tokens across colors, spacing, and typography.',
      ];
  }
}

function getProductionRequirements(prompt: string): string[] {
  const requirements: string[] = [];
  const text = prompt.toLowerCase();

  if (/auth|login|sign|account|user|member|profile/i.test(text)) {
    requirements.push('AUTH: Implement Supabase Auth with email/password + optional Google OAuth. Protect routes for authenticated users. Never expose service_role keys in frontend code.');
  }
  if (/payment|stripe|billing|checkout|plan|subscription|prix/i.test(text)) {
    requirements.push('PAYMENTS: Use Stripe Checkout or Payment Element. Payment confirmation must happen server-side via webhook. Never trust client-side payment success alone.');
  }
  if (/api|endpoint|route|backend|server|edge function/i.test(text)) {
    requirements.push('API: RESTful routes with proper HTTP methods (GET/POST/PUT/DELETE), input validation (Zod or manual), auth middleware, and structured error responses.');
  }
  if (/real.?time|live|socket|presence|notification/i.test(text)) {
    requirements.push('REALTIME: Use Supabase Realtime channels with reconnection logic. Implement optimistic UI updates and conflict resolution for concurrent edits.');
  }
  if (/file|upload|image|storage|attachment/i.test(text)) {
    requirements.push('STORAGE: Validate file MIME type and size (client + server). Use Supabase Storage with bucket policies. Generate signed URLs for private files.');
  }
  if (/admin|role|permission|rbac|access control/i.test(text)) {
    requirements.push('ROLES: Implement role-based access (RBAC) with RLS policies in Supabase. Never rely on client-side role checks alone for sensitive actions.');
  }

  return requirements;
}

/**
 * Enriches a raw user prompt into a structured technical specification.
 * Returns an enriched prompt string ready for the generation LLM.
 */
export function buildMetaPrompt(rawPrompt: string, appType: string, knownIssues: string[]): string {
  const normalized = String(rawPrompt || '').trim();
  const category = detectAppCategory(appType, normalized);
  const categoryRequirements = getCategoryRequirements(category);
  const productionRequirements = getProductionRequirements(normalized);

  const universalRules = [
    'Design mobile-first (390px base) with graceful scaling to tablet (768px) and desktop (1280px+).',
    'Every interactive element must have hover, focus-visible, active, disabled, and loading states.',
    'Never invent user-facing records or statistics. Use specific interface copy and honest empty states instead of lorem ipsum or sample records.',
    'Apply consistent design tokens: semantic color roles, spacing scale (4px base), radius scale, and typography hierarchy.',
    'All forms require field-level validation with error messages displayed near the field, not in a generic alert.',
    'Handle network errors gracefully: show retry option, never crash with an unhandled promise rejection.',
  ];

  const issueSection = knownIssues.length > 0
    ? `\nCRITICAL — AVOID THESE KNOWN FAILURE MODES:\n${knownIssues.map(i => `  ⚠ ${i}`).join('\n')}`
    : '';

  const productionSection = productionRequirements.length > 0
    ? `\nPRODUCTION REQUIREMENTS (because the request implies these):\n${productionRequirements.map(r => `  → ${r}`).join('\n')}`
    : '';

  return `[ENRICHED TECHNICAL SPECIFICATION]
Original Request: "${normalized}"
App Category: ${category} (app type: ${appType})

UNIVERSAL QUALITY REQUIREMENTS:
${universalRules.map(r => `  • ${r}`).join('\n')}

CATEGORY-SPECIFIC REQUIREMENTS (${category}):
${categoryRequirements.map(r => `  • ${r}`).join('\n')}
${productionSection}
${issueSection}

INSTRUCTION: Generate the complete implementation satisfying all requirements above.
Do NOT acknowledge this specification. Execute it directly.
`.trim();
}

/**
 * Wraps an enriched prompt with the original intent for dual-context clarity.
 */
export function parseEnrichedPrompt(enrichedOutput: string, originalPrompt: string): string {
  if (!enrichedOutput || enrichedOutput.length < 10) return originalPrompt;
  return `[ENRICHED SPECIFICATION]\n${enrichedOutput}\n\n[ORIGINAL INTENT]\n${originalPrompt}`;
}
