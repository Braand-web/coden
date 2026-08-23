export type ProductionBlueprintType =
  | 'saas'
  | 'marketplace'
  | 'crm'
  | 'booking'
  | 'ecommerce'
  | 'admin_dashboard'
  | 'internal_tool'
  | 'ai_tool'
  | 'blog_cms'
  // ─── Universal open-ended types ──────────────────────────────────────────────
  | 'productivity_tool'   // todo, task manager, kanban, notes, timer, pomodoro
  | 'social_platform'     // feed, posts, follows, comments, reactions
  | 'education_platform'  // courses, quizzes, progress, LMS
  | 'healthcare_app'      // patients, appointments, prescriptions, clinics
  | 'finance_tool'        // calculator, budget tracker, invoice, invoicing
  | 'creative_tool'       // canvas, image editor, music, drawing, design tool
  | 'game_interactive'    // games, simulations, quizzes, interactive experiences
  | 'directory_listing'   // yellow pages, profiles, job board, real estate
  | 'communication_tool'  // chat, messaging, notifications, email client
  | 'data_tool'           // CSV import, JSON viewer, converter, data explorer
  | 'generic_web_app';    // catch-all for anything else — no assumptions injected

export type ProductionBlueprintTable = {
  name: string;
  purpose: string;
  columns: string[];
  access: 'owner' | 'organization' | 'public_read_private_write';
  indexes: string[];
  sensitive?: boolean;
};

export type ProductionBlueprint = {
  type: ProductionBlueprintType;
  label: string;
  frontend: {
    framework: 'vite-react-ts' | 'nextjs-react-ts';
    requiredFiles: string[];
    requiredStates: string[];
  };
  backend: {
    provider: 'coden-cloud-supabase';
    features: string[];
    requiresAuth: boolean;
    requiresDatabase: boolean;
    requiresStorage: boolean;
    requiresBilling: boolean;
  };
  pages: string[];
  tables: ProductionBlueprintTable[];
  components: string[];
  workflows: string[];
  tests: string[];
  risks: string[];
  acceptanceCriteria: string[];
};

const COMMON_REQUIRED_FILES = [
  'package.json',
  'index.html',
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
  'src/app.test.ts',
  'README.md',
];

const COMMON_STATES = ['loading', 'empty', 'error', 'success', 'disabled'];

const COMMON_TESTS = [
  'typescript_build',
  'preview_non_empty',
  'responsive_mobile_first',
  'primary_controls_work',
  'no_frontend_secrets',
  'no_fake_production_readiness',
];

const COMMON_ACCEPTANCE = [
  'The generated app renders without a blank screen.',
  'Primary controls have visible behavior or honest disabled feedback.',
  'Private data paths require a session and role-aware access.',
  'No service role key, provider secret, or raw token is present in frontend files.',
  'Generated SQL enables RLS on every user table and includes matching policies.',
];

function table(
  name: string,
  purpose: string,
  columns: string[] = [],
  access: ProductionBlueprintTable['access'] = 'organization',
  options: Partial<Pick<ProductionBlueprintTable, 'indexes' | 'sensitive'>> = {},
): ProductionBlueprintTable {
  return {
    name,
    purpose,
    columns,
    access,
    indexes: options.indexes || ['organization_id', 'owner_id', 'created_at'],
    sensitive: options.sensitive,
  };
}

const BLUEPRINTS: Record<ProductionBlueprintType, ProductionBlueprint> = {
  saas: {
    type: 'saas',
    label: 'SaaS',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'usage', 'billing-ready'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['landing', 'auth', 'dashboard', 'settings', 'billing', 'admin'],
    tables: [
      table('app_projects', 'User-created SaaS projects'),
      table('app_usage_events', 'Metered product usage', ['event_type text not null', "units integer not null default 1"], 'organization', { sensitive: true }),
      table('app_subscriptions', 'Subscription state mirrored from billing provider', ['provider_customer_id text', 'provider_subscription_id text', "status text not null default 'inactive'"], 'organization', { sensitive: true }),
      table('app_audit_logs', 'Sensitive action audit trail', ['action text not null', "actor_role text not null default 'member'"], 'organization', { sensitive: true }),
    ],
    components: ['workspace shell', 'dashboard cards', 'settings panel', 'usage meter', 'billing status'],
    workflows: ['invite member', 'create project', 'update settings', 'record usage', 'review audit log'],
    tests: [...COMMON_TESTS, 'auth_route_protection', 'usage_events_rls', 'billing_not_client_only'],
    risks: ['tenant isolation', 'billing drift', 'admin permission leakage'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Workspace data is isolated by organization membership.'],
  },
  marketplace: {
    type: 'marketplace',
    label: 'Marketplace',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'storage', 'payments-ready'], requiresAuth: true, requiresDatabase: true, requiresStorage: true, requiresBilling: true },
    pages: ['home', 'search', 'listing detail', 'seller dashboard', 'orders', 'checkout'],
    tables: [
      table('app_sellers', 'Seller profiles and verification state', ['display_name text not null', "verification_status text not null default 'pending'"], 'organization', { sensitive: true }),
      table('app_products', 'Seller products or listings', ['seller_id uuid', 'price_cents integer not null default 0', "status text not null default 'draft'"], 'organization'),
      table('app_orders', 'Buyer orders', ['buyer_id uuid references auth.users(id)', 'seller_id uuid', "status text not null default 'pending'", 'total_cents integer not null default 0'], 'organization', { sensitive: true }),
      table('app_payments', 'Payment status mirrored from Stripe', ['order_id uuid', 'provider_payment_id text', "status text not null default 'pending'"], 'organization', { sensitive: true }),
      table('app_reviews', 'Buyer reviews', ['product_id uuid', 'rating integer check (rating between 1 and 5)', 'body text'], 'organization'),
    ],
    components: ['search filters', 'listing cards', 'seller trust badge', 'cart/checkout state', 'order timeline'],
    workflows: ['seller onboarding', 'publish listing', 'place order', 'review order', 'moderate listing'],
    tests: [...COMMON_TESTS, 'seller_product_policy', 'buyer_order_policy', 'payment_webhook_signature'],
    risks: ['buyer/seller data leakage', 'client-only pricing', 'unsafe uploads'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Orders, payments, products, and sellers have RLS policies.'],
  },
  crm: {
    type: 'crm',
    label: 'CRM',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'audit_logs'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['dashboard', 'contacts', 'companies', 'deals', 'tasks', 'settings'],
    tables: [
      table('app_companies', 'Account records', ['domain text', "status text not null default 'active'"]),
      table('app_contacts', 'People linked to companies', ['company_id uuid', 'email text', 'phone text']),
      table('app_deals', 'Pipeline opportunities', ['company_id uuid', 'amount_cents integer not null default 0', "stage text not null default 'lead'"]),
      table('app_tasks', 'Follow-up tasks', ['due_at timestamptz', "status text not null default 'todo'"]),
      table('app_notes', 'Private notes on CRM records', ['body text not null'], 'organization', { sensitive: true }),
      table('app_audit_logs', 'Sensitive CRM action audit trail', ['action text not null'], 'organization', { sensitive: true }),
    ],
    components: ['sidebar', 'client table', 'contacts table', 'pipeline board', 'task drawer', 'notes panel'],
    workflows: ['create contact', 'move deal stage', 'assign task', 'add note', 'export safe view'],
    tests: [...COMMON_TESTS, 'contact_crud', 'pipeline_stage_updates', 'notes_private_policy'],
    risks: ['private customer data leakage', 'notes visible across organizations'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Contacts, deals, tasks, notes, and audit logs are organization-scoped.'],
  },
  booking: {
    type: 'booking',
    label: 'Booking',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'payments-ready', 'realtime-optional'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: true },
    pages: ['services', 'calendar', 'booking flow', 'customers', 'payments'],
    tables: [
      table('app_services', 'Bookable services', ['duration_minutes integer not null default 30', 'price_cents integer not null default 0']),
      table('app_availability', 'Availability windows', ['starts_at timestamptz not null', 'ends_at timestamptz not null']),
      table('app_customers', 'Customer profiles', ['email text', 'phone text'], 'organization', { sensitive: true }),
      table('app_bookings', 'Reservations', ['customer_id uuid', 'service_id uuid', 'starts_at timestamptz not null', "status text not null default 'pending'"], 'organization', { sensitive: true }),
      table('app_payments', 'Booking payment state', ['booking_id uuid', 'provider_payment_id text', "status text not null default 'pending'"], 'organization', { sensitive: true }),
    ],
    components: ['calendar', 'service cards', 'booking form', 'availability editor', 'confirmation state'],
    workflows: ['choose service', 'select time', 'validate booking', 'confirm payment', 'reschedule'],
    tests: [...COMMON_TESTS, 'booking_validation', 'double_booking_guard', 'payment_status_server_side'],
    risks: ['double booking', 'private customer data leakage', 'client-only payment status'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Booking writes validate service, customer, time, and ownership.'],
  },
  ecommerce: {
    type: 'ecommerce',
    label: 'E-commerce',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'storage', 'payments-ready'], requiresAuth: true, requiresDatabase: true, requiresStorage: true, requiresBilling: true },
    pages: ['catalog', 'product detail', 'cart', 'checkout', 'orders', 'admin inventory'],
    tables: [
      table('app_products', 'Product catalog', ['sku text', 'price_cents integer not null default 0', 'inventory_count integer not null default 0'], 'public_read_private_write'),
      table('app_customers', 'Customer profiles', ['user_id uuid references auth.users(id)', 'email text'], 'owner', { sensitive: true }),
      table('app_orders', 'Customer orders', ['customer_id uuid', "status text not null default 'pending'", 'total_cents integer not null default 0'], 'organization', { sensitive: true }),
      table('app_order_items', 'Order line items', ['order_id uuid', 'product_id uuid', 'quantity integer not null default 1', 'price_cents integer not null default 0'], 'organization', { sensitive: true }),
      table('app_payments', 'Payment state mirrored by webhook', ['order_id uuid', 'provider_payment_id text', "status text not null default 'pending'"], 'organization', { sensitive: true }),
    ],
    components: ['catalog filters', 'product cards', 'cart drawer', 'checkout summary', 'order status'],
    workflows: ['filter products', 'add to cart', 'checkout', 'view order', 'manage inventory'],
    tests: [...COMMON_TESTS, 'cart_state_mutates', 'checkout_not_client_only', 'inventory_non_negative'],
    risks: ['price tampering', 'stock drift', 'payment status spoofing'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Checkout pricing is server-owned or marked as preview-only.'],
  },
  admin_dashboard: {
    type: 'admin_dashboard',
    label: 'Admin Dashboard',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'audit_logs'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['overview', 'users', 'reports', 'settings', 'audit logs'],
    tables: [
      table('app_resources', 'Managed internal resources', ['kind text not null', "status text not null default 'active'"]),
      table('app_reports', 'Operational reports', ['report_type text not null', "payload jsonb not null default '{}'::jsonb"]),
      table('app_audit_logs', 'Admin action audit trail', ['action text not null'], 'organization', { sensitive: true }),
    ],
    components: ['sidebar', 'metrics', 'tables', 'filters', 'role badges', 'audit log'],
    workflows: ['review metrics', 'filter table', 'approve action', 'inspect audit log'],
    tests: [...COMMON_TESTS, 'admin_routes_protected', 'audit_log_present'],
    risks: ['admin overexposure', 'missing audit trail'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Admin views are role-protected and audited.'],
  },
  internal_tool: {
    type: 'internal_tool',
    label: 'Internal Tool',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'audit_logs'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['workspace', 'records', 'approvals', 'settings', 'audit logs'],
    tables: [
      table('app_resources', 'Internal records', ['kind text not null', "status text not null default 'open'"]),
      table('app_tasks', 'Operational tasks', ['assignee_id uuid references auth.users(id)', "status text not null default 'todo'"]),
      table('app_audit_logs', 'Internal action audit trail', ['action text not null'], 'organization', { sensitive: true }),
    ],
    components: ['command bar', 'record table', 'approval queue', 'detail drawer'],
    workflows: ['create record', 'approve task', 'assign owner', 'audit action'],
    tests: [...COMMON_TESTS, 'role_guarded_actions', 'approval_feedback'],
    risks: ['private operational data leakage', 'missing confirmation on destructive actions'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Sensitive internal actions require role-aware checks.'],
  },
  ai_tool: {
    type: 'ai_tool',
    label: 'AI Tool',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'edge_functions', 'secrets', 'ai_connector', 'sse_streaming'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['prompt workspace', 'history', 'settings', 'usage'],
    tables: [
      table('app_prompts', 'Saved user prompts', ['body text not null']),
      table('app_generations', 'Generated outputs', ['prompt_id uuid', "status text not null default 'queued'", "result jsonb not null default '{}'::jsonb"], 'organization', { sensitive: true }),
      table('app_usage_events', 'AI usage accounting', ['event_type text not null', "units integer not null default 1"], 'organization', { sensitive: true }),
    ],
    components: ['prompt input', 'stream status', 'history list', 'usage meter', 'settings', 'cancel stream', 'retry failed response'],
    workflows: ['submit prompt', 'stream result through edge function', 'cancel generation', 'view result', 'retry generation', 'review usage'],
    tests: [...COMMON_TESTS, 'ai_secret_server_only', 'edge_ai_stream_present', 'usage_recorded', 'history_persists'],
    risks: ['provider key exposure', 'unbounded usage', 'fake streaming', 'missing stream cancellation'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Provider keys stay server-side and usage is recorded.', 'AI responses stream through a server-side connector with loading, error, retry and cancel states.'],
  },
  blog_cms: {
    type: 'blog_cms',
    label: 'Blog/CMS',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'storage'], requiresAuth: true, requiresDatabase: true, requiresStorage: true, requiresBilling: false },
    pages: ['home', 'post detail', 'editor', 'media library', 'settings'],
    tables: [
      table('app_posts', 'Published and draft content', ['slug text not null', 'body text not null', "status text not null default 'draft'"], 'public_read_private_write'),
      table('app_categories', 'Content categories', ['slug text not null'], 'public_read_private_write'),
      table('app_comments', 'Reader comments', ['post_id uuid', 'body text not null', "status text not null default 'pending'"], 'organization', { sensitive: true }),
      table('app_assets', 'Uploaded media metadata', ['bucket text not null default \'app-assets\'', 'path text not null', 'mime_type text', 'size_bytes bigint not null default 0'], 'organization', { sensitive: true }),
    ],
    components: ['post list', 'editor', 'media picker', 'category filters', 'preview state'],
    workflows: ['write draft', 'publish post', 'upload media', 'moderate comment'],
    tests: [...COMMON_TESTS, 'editor_validation', 'public_read_private_write_policy', 'storage_metadata_safe'],
    risks: ['unsafe uploads', 'unmoderated public content', 'private draft leakage'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Drafts are private and published content is intentionally public.'],
  },

  // ─── Universal open-ended blueprints ─────────────────────────────────────────

  productivity_tool: {
    type: 'productivity_tool',
    label: 'Productivity Tool',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['local_state', 'optional_persistence'], requiresAuth: false, requiresDatabase: false, requiresStorage: false, requiresBilling: false },
    pages: ['main workspace', 'history or archive', 'settings'],
    tables: [],
    components: ['primary action area', 'item list', 'filters/tabs', 'empty state', 'settings panel'],
    workflows: ['create item', 'complete/toggle item', 'delete item', 'filter items', 'persist to localStorage'],
    tests: [...COMMON_TESTS, 'primary_action_creates_item', 'filter_affects_list', 'localStorage_persists'],
    risks: ['localStorage corrupted state', 'no empty state', 'no keyboard support'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE.filter(c => !c.includes('Private data')), 'Primary workflow works with local state before any backend is connected.'],
  },

  social_platform: {
    type: 'social_platform',
    label: 'Social Platform',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'realtime', 'storage'], requiresAuth: true, requiresDatabase: true, requiresStorage: true, requiresBilling: false },
    pages: ['feed', 'profile', 'notifications', 'explore', 'settings'],
    tables: [
      table('app_profiles', 'User profiles', ['username text not null', 'bio text', 'avatar_url text'], 'owner', { sensitive: true }),
      table('app_posts', 'User posts', ['body text not null', "visibility text not null default 'public'"], 'owner'),
      table('app_follows', 'Follow relationships', ['follower_id uuid', 'following_id uuid'], 'owner'),
      table('app_reactions', 'Post reactions', ['post_id uuid', "kind text not null default 'like'"], 'owner'),
      table('app_comments', 'Post comments', ['post_id uuid', 'body text not null'], 'owner'),
    ],
    components: ['feed', 'post card', 'profile header', 'follow button', 'reaction bar', 'notifications list'],
    workflows: ['create post', 'like post', 'follow user', 'view profile', 'view notifications'],
    tests: [...COMMON_TESTS, 'feed_updates', 'follow_state_changes', 'notification_appears'],
    risks: ['private post leakage', 'unscoped notifications', 'infinite scroll without pagination'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Posts are visibility-scoped and reactions are owner-only.'],
  },

  education_platform: {
    type: 'education_platform',
    label: 'Education Platform',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['course catalog', 'course detail', 'lesson viewer', 'progress dashboard', 'quiz', 'settings'],
    tables: [
      table('app_courses', 'Course catalog', ['title text not null', 'description text', "status text not null default 'draft'"], 'public_read_private_write'),
      table('app_lessons', 'Course lessons', ['course_id uuid', 'title text not null', 'content text not null', 'order_index integer not null default 0'], 'public_read_private_write'),
      table('app_enrollments', 'Student enrollments', ['course_id uuid', "status text not null default 'active'"], 'owner', { sensitive: true }),
      table('app_progress', 'Lesson completion tracking', ['lesson_id uuid', 'completed_at timestamptz'], 'owner', { sensitive: true }),
      table('app_quiz_responses', 'Quiz answers', ['quiz_id uuid', 'score integer'], 'owner', { sensitive: true }),
    ],
    components: ['course card', 'lesson list', 'progress bar', 'quiz component', 'certificate state'],
    workflows: ['enroll in course', 'watch/read lesson', 'mark complete', 'take quiz', 'view progress'],
    tests: [...COMMON_TESTS, 'enrollment_creates_progress', 'quiz_scoring_works', 'progress_persists'],
    risks: ['quiz answers visible to other students', 'progress not persisted', 'no empty enrolled state'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Progress and quiz responses are owner-scoped.'],
  },

  healthcare_app: {
    type: 'healthcare_app',
    label: 'Healthcare App',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'audit_logs'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['dashboard', 'patients', 'appointments', 'records', 'settings'],
    tables: [
      table('app_patients', 'Patient records', ['full_name text not null', 'date_of_birth date', 'contact_info jsonb'], 'organization', { sensitive: true }),
      table('app_appointments', 'Appointments', ['patient_id uuid', 'scheduled_at timestamptz not null', "status text not null default 'scheduled'"], 'organization', { sensitive: true }),
      table('app_records', 'Clinical notes (demo only)', ['patient_id uuid', "note text not null", 'is_demo boolean not null default true'], 'organization', { sensitive: true }),
    ],
    components: ['patient list', 'appointment calendar', 'record form', 'status badges', 'demo disclaimer'],
    workflows: ['view patients', 'book appointment', 'add note (demo)', 'cancel appointment'],
    tests: [...COMMON_TESTS, 'patient_data_org_scoped', 'demo_disclaimer_visible'],
    risks: ['real medical data without proper security', 'missing HIPAA/GDPR disclaimers', 'clinical claims'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'All patient data is clearly labeled as demo. No real medical advice is implied.'],
  },

  finance_tool: {
    type: 'finance_tool',
    label: 'Finance Tool',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['local_state', 'optional_auth'], requiresAuth: false, requiresDatabase: false, requiresStorage: false, requiresBilling: false },
    pages: ['dashboard', 'transactions', 'budgets', 'reports', 'settings'],
    tables: [],
    components: ['balance summary', 'transaction list', 'budget bars', 'category filters', 'export button'],
    workflows: ['add transaction', 'set budget', 'filter by category', 'view report', 'export CSV'],
    tests: [...COMMON_TESTS, 'transaction_mutates_balance', 'budget_shows_progress', 'export_generates_data'],
    risks: ['fake bank behavior', 'missing confirmation on delete', 'unclear currency formatting'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE.filter(c => !c.includes('Private data')), 'Financial amounts are formatted with currency and locale. Destructive actions require confirmation.'],
  },

  creative_tool: {
    type: 'creative_tool',
    label: 'Creative Tool',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['local_state', 'optional_storage'], requiresAuth: false, requiresDatabase: false, requiresStorage: false, requiresBilling: false },
    pages: ['canvas/workspace', 'gallery/history', 'settings'],
    tables: [],
    components: ['interactive canvas/stage', 'tool controls', 'color/style picker', 'history/undo', 'export/save'],
    workflows: ['create', 'edit', 'undo/redo', 'export result', 'clear/reset'],
    tests: [...COMMON_TESTS, 'primary_create_action_works', 'undo_reverts_state', 'export_produces_output'],
    risks: ['controls that do nothing', 'no undo/reset', 'no save/export'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE.filter(c => !c.includes('Private data')), 'Primary creative action produces visible output. Undo and reset work.'],
  },

  game_interactive: {
    type: 'game_interactive',
    label: 'Game / Interactive',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['local_state'], requiresAuth: false, requiresDatabase: false, requiresStorage: false, requiresBilling: false },
    pages: ['game screen', 'score/leaderboard', 'settings'],
    tables: [],
    components: ['game stage', 'score counter', 'controls', 'game over state', 'restart button', 'how-to-play'],
    workflows: ['start game', 'play action', 'score update', 'game over', 'restart'],
    tests: [...COMMON_TESTS, 'game_starts', 'score_increments', 'game_over_triggers', 'restart_works'],
    risks: ['game loop not working', 'no restart', 'no score', 'no keyboard/touch support'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE.filter(c => !c.includes('Private data')), 'Core game loop runs. Score updates. Game over and restart work.'],
  },

  directory_listing: {
    type: 'directory_listing',
    label: 'Directory / Listing',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['database', 'optional_auth'], requiresAuth: false, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['directory home', 'listing detail', 'submit listing', 'search results'],
    tables: [
      table('app_listings', 'Directory entries', ['title text not null', 'description text', 'category text', "status text not null default 'active'"], 'public_read_private_write'),
      table('app_categories', 'Directory categories', ['name text not null', 'slug text not null'], 'public_read_private_write'),
    ],
    components: ['search bar', 'filters', 'listing cards', 'listing detail', 'submit form', 'no-results state'],
    workflows: ['search/filter listings', 'view detail', 'submit new listing', 'contact listing'],
    tests: [...COMMON_TESTS, 'search_filters_listings', 'listing_detail_renders', 'submit_form_validates'],
    risks: ['no no-results state', 'dead contact action', 'missing category filter'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Search and category filters affect listings. Listing detail shows all relevant info.'],
  },

  communication_tool: {
    type: 'communication_tool',
    label: 'Communication Tool',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['auth', 'database', 'realtime'], requiresAuth: true, requiresDatabase: true, requiresStorage: false, requiresBilling: false },
    pages: ['conversations list', 'conversation/chat view', 'notifications', 'settings'],
    tables: [
      table('app_conversations', 'Conversation threads', ['title text', "kind text not null default 'direct'"], 'organization'),
      table('app_messages', 'Messages in conversations', ['conversation_id uuid', 'body text not null', "status text not null default 'sent'"], 'owner', { sensitive: true }),
      table('app_participants', 'Conversation participants', ['conversation_id uuid', 'user_id uuid'], 'organization', { sensitive: true }),
    ],
    components: ['conversation list', 'message thread', 'message input', 'typing indicator', 'unread badge'],
    workflows: ['start conversation', 'send message', 'receive message', 'mark read', 'search conversations'],
    tests: [...COMMON_TESTS, 'send_message_appears', 'unread_count_updates', 'conversation_list_loads'],
    risks: ['messages visible across conversations', 'no optimistic UI', 'no empty state'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE, 'Messages are scoped to conversation participants. Unread state updates.'],
  },

  data_tool: {
    type: 'data_tool',
    label: 'Data Tool',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    backend: { provider: 'coden-cloud-supabase', features: ['local_state', 'optional_storage'], requiresAuth: false, requiresDatabase: false, requiresStorage: false, requiresBilling: false },
    pages: ['input/import view', 'data table/preview', 'transform/filter view', 'export view'],
    tables: [],
    components: ['file upload or paste area', 'data table', 'column filters', 'transform controls', 'export button'],
    workflows: ['import data', 'inspect data', 'filter/sort/transform', 'export result'],
    tests: [...COMMON_TESTS, 'import_produces_table', 'filter_reduces_rows', 'export_downloads_file'],
    risks: ['large file browser freeze', 'no error for malformed input', 'no export action'],
    acceptanceCriteria: [...COMMON_ACCEPTANCE.filter(c => !c.includes('Private data')), 'Import, transform, and export work end-to-end using user-provided or real source data.'],
  },

  generic_web_app: {
    type: 'generic_web_app',
    label: 'Web App',
    frontend: { framework: 'vite-react-ts', requiredFiles: COMMON_REQUIRED_FILES, requiredStates: COMMON_STATES },
    // No backend assumptions — the LLM infers what is needed from the prompt
    backend: { provider: 'coden-cloud-supabase', features: [], requiresAuth: false, requiresDatabase: false, requiresStorage: false, requiresBilling: false },
    pages: ['main screen', 'secondary screens as needed'],
    tables: [],
    components: ['inferred from prompt'],
    workflows: ['inferred from prompt'],
    tests: COMMON_TESTS,
    risks: ['blank preview if requirements are unclear'],
    acceptanceCriteria: [
      'The generated app renders without a blank screen.',
      'Primary controls have visible behavior.',
      'No service role key or provider secret is present in frontend files.',
      'The app matches the product type described in the prompt, not a generic template.',
    ],
  },
};

export function inferProductionBlueprint(prompt: string): ProductionBlueprint {
  const text = String(prompt || '').toLowerCase();

  // ── Known specific types (most precise match wins) ──────────────────────────
  if (/\b(marketplace|seller|buyer|listing|vendeur|acheteur|annonce)\b/.test(text)) return BLUEPRINTS.marketplace;
  if (/\b(crm|pipeline|deal|lead|prospect)\b/.test(text)) return BLUEPRINTS.crm;
  if (/\b(booking|reservation|appointment|availability|rendez-vous)\b/.test(text)) return BLUEPRINTS.booking;
  if (/\b(e-?commerce|shop|store|cart|catalog|checkout|inventory|boutique|panier|catalogue)\b/.test(text)) return BLUEPRINTS.ecommerce;
  if (/\b(admin dashboard|admin panel|back office|back-office|operations dashboard)\b/.test(text)) return BLUEPRINTS.admin_dashboard;
  if (/\b(internal tool|outil interne|approval|approbation|ops tool)\b/.test(text)) return BLUEPRINTS.internal_tool;
  if (/\b(ai tool|chatbot|prompt|agent|generator|generateur ia|outil ia)\b/.test(text)) return BLUEPRINTS.ai_tool;
  if (/\b(blog|cms|article|editorial|content management|publication)\b/.test(text)) return BLUEPRINTS.blog_cms;

  // ── Universal open-ended types ──────────────────────────────────────────────
  if (/\b(todo|task|tache|taches|kanban|pomodoro|timer|minuteur|note|notes|checklist|planner|agenda)\b/.test(text)) return BLUEPRINTS.productivity_tool;
  if (/\b(social|feed|post|posts|follow|followers|like|reaction|community|reseau social|forum|timeline)\b/.test(text)) return BLUEPRINTS.social_platform;
  if (/\b(course|cours|learning|lms|quiz|lesson|module|student|teacher|education|formation|e-learning)\b/.test(text)) return BLUEPRINTS.education_platform;
  if (/\b(patient|doctor|clinic|medical|health|prescription|appointment|sante|clinique|hopital)\b/.test(text)) return BLUEPRINTS.healthcare_app;
  if (/\b(budget|calculator|calculatrice|invoice|facture|expense|depense|finance|comptabilite|salary|salaire)\b/.test(text)) return BLUEPRINTS.finance_tool;
  if (/\b(canvas|drawing|dessin|paint|image editor|music|audio|creative|creation|design tool|whiteboard)\b/.test(text)) return BLUEPRINTS.creative_tool;
  if (/\b(game|jeu|simulation|quiz|puzzle|interactive|trivia|tetris|snake|chess|echecs)\b/.test(text)) return BLUEPRINTS.game_interactive;
  if (/\b(directory|annuaire|listing|job board|real estate|immobilier|profile|profiles|yellow pages|catalogue d entreprises)\b/.test(text)) return BLUEPRINTS.directory_listing;
  if (/\b(chat|message|messagerie|notification|inbox|email client|communication|discussion)\b/.test(text)) return BLUEPRINTS.communication_tool;
  if (/\b(csv|json|xml|data explorer|converter|convertisseur|parser|viewer|import|export|data tool)\b/.test(text)) return BLUEPRINTS.data_tool;

  // ── SaaS only when explicitly mentioned ─────────────────────────────────────
  if (/\b(saas|workspace|subscription|multi.?tenant|tableau de bord saas)\b/.test(text)) return BLUEPRINTS.saas;

  // ── True universal fallback — no category assumptions injected ───────────────
  // Don't default to 'saas'. Use generic_web_app which gives the LLM
  // freedom to infer the correct product shape from the prompt alone.
  return BLUEPRINTS.generic_web_app;
}

export function listProductionBlueprints() {
  return Object.values(BLUEPRINTS);
}

export function getProductionBlueprintByType(type: string): ProductionBlueprint | null {
  return BLUEPRINTS[String(type || '').trim() as ProductionBlueprintType] || null;
}

export function buildProductionBlueprintPromptContext(blueprint: ProductionBlueprint) {
  return [
    'Optional production architecture reference:',
    'This reference may suggest proven engineering checks, but it must never constrain the product shape, add unrequested category features, or override the universal product contract.',
    JSON.stringify({
      type: blueprint.type,
      label: blueprint.label,
      frontend: blueprint.frontend,
      backend: blueprint.backend,
      pages: blueprint.pages,
      tables: blueprint.tables.map(table => ({
        name: table.name,
        purpose: table.purpose,
        access: table.access,
        sensitive: Boolean(table.sensitive),
      })),
      components: blueprint.components,
      workflows: blueprint.workflows,
      tests: blueprint.tests,
      risks: blueprint.risks,
      acceptanceCriteria: blueprint.acceptanceCriteria,
      hardRules: [
        'Do not deliver a plain demo when the user asked for a real app.',
        'Do not use localStorage as production persistence for real data.',
        'Do not expose service_role or provider secrets in frontend code.',
        'Every private table needs RLS and policies.',
        'Payments require a server-side webhook signature path.',
        'Production-ready can only be claimed after real checks.',
      ],
    }),
  ].join('\n');
}

export function isPaymentBlueprint(blueprint: ProductionBlueprint) {
  return blueprint.backend.requiresBilling || blueprint.tables.some(item => /payment|subscription/i.test(item.name));
}

export function isStorageBlueprint(blueprint: ProductionBlueprint) {
  return blueprint.backend.requiresStorage || blueprint.tables.some(item => /asset|file|media/i.test(item.name));
}
