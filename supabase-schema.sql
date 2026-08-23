-- Supabase Database Schema for SaaS AI App Platform (Coden)
-- This file defines the tabular architecture, foreign keys, row-level security (RLS), and indexing.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────────────────────────────
-- 1. BASE PLANS & FEATURES
-- ──────────────────────────────────────────────────────────────────────

create table public.plans (
    id uuid primary key default uuid_generate_v4(),
    name text not null unique,
    description text,
    amount_monthly decimal(10, 2) not null,
    amount_yearly decimal(10, 2) not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.plan_features (
    id uuid primary key default uuid_generate_v4(),
    plan_id uuid references public.plans(id) on delete cascade not null,
    monthly_credits integer not null,
    active_projects_limit integer not null,
    custom_domains_limit integer not null,
    allowed_model_tiers text[] not null, -- {'Economy', 'Standard', 'Pro', 'Premium'}
    github_sync boolean default false not null,
    supabase_integration boolean default false not null,
    team_collaboration boolean default false not null,
    audit_logs boolean default false not null,
    version_history_days integer not null,
    priority_builds boolean default false not null,
    badge_removal boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ──────────────────────────────────────────────────────────────────────
-- 2. SUBSCRIPTIONS & CLIENT INFRASTRUCTURE
-- ──────────────────────────────────────────────────────────────────────

create table public.stripe_customers (
    id uuid primary key, -- user_id or organization_id
    stripe_customer_id text not null unique,
    email text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.subscriptions (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid not null,
    stripe_subscription_id text unique,
    plan_id uuid references public.plans(id) on delete restrict not null,
    status text not null, -- 'active', 'trialing', 'canceled', 'past_due'
    current_period_start timestamp with time zone not null,
    current_period_end timestamp with time zone not null,
    cancel_at_period_end boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.stripe_events (
    id uuid primary key default uuid_generate_v4(),
    event_id text unique not null,
    event_type text not null,
    processed boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.topup_products (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    credits integer not null,
    price_usd decimal(10, 2) not null,
    status text default 'active' not null, -- 'active', 'archived'
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ──────────────────────────────────────────────────────────────────────
-- 3. WALLETS & LEDGERS (CREDIT SYSTEM)
-- ──────────────────────────────────────────────────────────────────────

create table public.credit_wallets (
    organization_id uuid primary key,
    balance decimal(12, 2) default 0.00 not null,
    promo_balance decimal(12, 2) default 0.00 not null,
    last_granted_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.credit_ledger (
    id uuid primary key default uuid_generate_v4(),
    wallet_id uuid references public.credit_wallets(organization_id) on delete cascade not null,
    type text not null, -- 'subscription_grant', 'topup', 'usage', 'refund', 'bonus'
    amount decimal(12, 2) not null, -- negative for debit, positive for credit
    balance_after decimal(12, 2) not null,
    description text,
    reference_id text, -- matches Stripe payment intent, AI request id, etc.
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.credit_reservations (
    id uuid primary key default uuid_generate_v4(),
    wallet_id uuid references public.credit_wallets(organization_id) on delete cascade not null,
    amount decimal(12, 2) not null,
    status text default 'reserved' not null, -- 'reserved', 'committed', 'released'
    reference_id text unique, -- AI Request / Action ID
    expires_at timestamp with time zone not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ──────────────────────────────────────────────────────────────────────
-- 4. DOMAINS, DNS & ALIASES
-- ──────────────────────────────────────────────────────────────────────

create table public.domains (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid not null,
    project_id uuid not null,
    domain text unique not null,
    type text not null, -- 'subdomain', 'custom'
    status text default 'pending' not null, -- 'pending', 'verified', 'active', 'failed', 'removed'
    is_primary boolean default false not null,
    vercel_project_id text,
    vercel_domain_id text,
    verification_token text, -- TXT record value for custom domains
    last_checked_at timestamp with time zone,
    verified_at timestamp with time zone,
    error_message text,
    created_by uuid,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.dns_verifications (
    id uuid primary key default uuid_generate_v4(),
    domain_id uuid references public.domains(id) on delete cascade not null,
    record_type text not null, -- 'A', 'CNAME', 'TXT'
    record_name text not null,
    record_value text not null,
    status text default 'pending' not null, -- 'pending', 'verified', 'failed'
    checked_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.deployment_aliases (
    id uuid primary key default uuid_generate_v4(),
    project_id uuid not null,
    domain_id uuid references public.domains(id) on delete cascade not null,
    alias text not null unique,
    status text not null, -- 'active', 'inactive'
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.domain_addons (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid not null,
    domain text not null,
    extra_fee decimal(10, 2) default 0.00 not null,
    is_active boolean default true not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ──────────────────────────────────────────────────────────────────────
-- 5. AI ENGINE & ROUTING
-- ──────────────────────────────────────────────────────────────────────

create table public.ai_model_catalog (
    openrouter_model_id text primary key,
    display_name text not null,
    provider text not null,
    tier text not null, -- 'Economy', 'Standard', 'Pro', 'Premium', 'Max Quality'
    force_types text[] default '{}'::text[] not null, -- {'text', 'code', 'vision'}
    speed text, -- 'fast', 'moderate', 'slow'
    cost_estimate_tier text, -- 'low', 'medium', 'high', 'very high'
    is_allowed boolean default true not null,
    is_available boolean default true not null,
    max_context_tokens integer default 32000 not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.ai_model_pricing (
    model_id text primary key references public.ai_model_catalog(openrouter_model_id) on delete cascade,
    input_token_cost_usd decimal(12, 8) not null,
    output_token_cost_usd decimal(12, 8) not null,
    latency_ms integer,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.ai_requests (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid,
    organization_id uuid not null,
    project_id uuid not null,
    model_id text references public.ai_model_catalog(openrouter_model_id) on delete restrict not null,
    request_type text not null, -- 'chat', 'code_diff', 'compile_debug', 'initial_generation'
    status text not null, -- 'reserved', 'processing', 'completed', 'failed', 'refunded'
    error_details text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.ai_request_usage (
    id uuid primary key references public.ai_requests(id) on delete cascade,
    input_tokens integer default 0 not null,
    output_tokens integer default 0 not null,
    cached_tokens integer default 0 not null,
    actual_cost_usd decimal(12, 8) default 0.00000000 not null,
    estimated_cost_credits decimal(10, 2) default 0.00 not null,
    final_cost_credits decimal(10, 2) default 0.00 not null,
    status text not null, -- 'computed', 'adjusted'
    logged_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.ai_routing_decisions (
    id uuid primary key default uuid_generate_v4(),
    request_id uuid references public.ai_requests(id) on delete cascade not null,
    user_id uuid,
    project_id uuid not null,
    requested_model text not null,
    routed_model text references public.ai_model_catalog(openrouter_model_id) on delete restrict not null,
    strategy_used text not null, -- 'Auto_Load_Balance', 'Plan_Restriction_Demotion', 'Budget_Exceeded_demotion'
    decision_reason text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.user_ai_preferences (
    user_id uuid primary key,
    default_routing_mode text default 'Auto' not null, -- 'Auto', 'Fast', 'Balanced', 'Pro', 'Premium'
    max_credits_per_action decimal(10, 2) default 50.00 not null,
    ask_confirm_before_premium boolean default true not null,
    auto_revert_to_auto boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.project_ai_preferences (
    project_id uuid primary key,
    default_routing_mode text default 'Auto' not null,
    max_credits_per_action decimal(10, 2) default 50.00 not null,
    ask_confirm_before_premium boolean default true not null,
    auto_revert_to_auto boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ──────────────────────────────────────────────────────────────────────
-- 6. AUDIT, LOGGING & TELEMETRY
-- ──────────────────────────────────────────────────────────────────────

create table public.audit_logs (
    id uuid primary key default uuid_generate_v4(),
    user_id text not null,
    organization_id text,
    project_id text,
    requested_model text,
    reason text not null,
    source text not null, -- 'cli', 'web', 'api'
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.member_credit_limits (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid not null,
    user_id uuid not null,
    monthly_budget decimal(12, 2) not null,
    consumed decimal(12, 2) default 0.00 not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(organization_id, user_id)
);

create table public.billing_alerts (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid not null,
    type text not null, -- 'budget_warning', 'margin_alert', 'high_usage'
    severity text not null, -- 'info', 'warning', 'critical'
    message text not null,
    is_resolved boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.usage_events (
    id uuid primary key default uuid_generate_v4(),
    organization_id uuid not null,
    project_id uuid,
    user_id uuid,
    action_type text not null, -- 'build', 'custom_domain_deployment', 'security_scan'
    cost_credits decimal(10, 2) default 0.00 not null,
    cost_usd decimal(10, 6) default 0.000000 not null,
    model_used text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ──────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ──────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.topup_products enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.domains enable row level security;
alter table public.dns_verifications enable row level security;
alter table public.deployment_aliases enable row level security;
alter table public.domain_addons enable row level security;
alter table public.ai_model_catalog enable row level security;
alter table public.ai_model_pricing enable row level security;
alter table public.ai_requests enable row level security;
alter table public.ai_request_usage enable row level security;
alter table public.ai_routing_decisions enable row level security;
alter table public.user_ai_preferences enable row level security;
alter table public.project_ai_preferences enable row level security;
alter table public.audit_logs enable row level security;
alter table public.member_credit_limits enable row level security;
alter table public.billing_alerts enable row level security;
alter table public.usage_events enable row level security;

-- Free public reads for catalog & plans
create policy "Plans read access" on public.plans for select using (true);
create policy "Plan features read access" on public.plan_features for select using (true);
create policy "AI Catalog read access" on public.ai_model_catalog for select using (true);
create policy "AI Model pricing read access" on public.ai_model_pricing for select using (true);

-- Customer limits: matching organization isolation
-- Helper: authenticate organization member
create policy "Stripe customers organization read" on public.stripe_customers
    for select using (auth.uid() = id);

create policy "Subscriptions read" on public.subscriptions
    for select using (organization_id = auth.uid()); -- assuming single user org default mappings

create policy "Wallets read" on public.credit_wallets
    for select using (organization_id = auth.uid());

create policy "Ledger read" on public.credit_ledger
    for select using (wallet_id = auth.uid());

create policy "Reservations read" on public.credit_reservations
    for select using (wallet_id = auth.uid());

create policy "Domains isolation" on public.domains
    for all using (organization_id = auth.uid());

create policy "DNS verification isolation" on public.dns_verifications
    for all using (
        domain_id in (select id from public.domains where organization_id = auth.uid())
    );

create policy "Deployment aliases isolation" on public.deployment_aliases
    for all using (
        domain_id in (select id from public.domains where organization_id = auth.uid())
    );

create policy "Domain addons read" on public.domain_addons
    for select using (organization_id = auth.uid());

create policy "AI Requests read" on public.ai_requests
    for select using (organization_id = auth.uid());

create policy "AI Request usage read" on public.ai_request_usage
    for select using (
        id in (select id from public.ai_requests where organization_id = auth.uid())
    );

create policy "AI preferences direct configuration access" on public.user_ai_preferences
    for all using (user_id = auth.uid());

create policy "Audit logs organization query" on public.audit_logs
    for select using (user_id = auth.uid()::text);

create policy "Member budget limits views" on public.member_credit_limits
    for select using (organization_id = auth.uid() or user_id = auth.uid());

create policy "Billing alerts organization feeds" on public.billing_alerts
    for select using (organization_id = auth.uid());

-- CRITICAL RESTRICTION: No clients are allowed to alter ledgers, pricing or metrics directly.
-- Standard insert, update, delete for structural ledger tables are blocked for authenticated clients
-- (unless using database service keys / postgres context).

create policy "Ledger system restriction write" on public.credit_ledger
    for insert with check (false); -- ONLY allowed via security-audited service functions or service role

create policy "Reservations system restriction write" on public.credit_reservations
    for insert with check (false);

create policy "Pricing catalog system restriction write" on public.ai_model_pricing
    for all using (false);

-- ──────────────────────────────────────────────────────────────────────
-- SYSTEM FUNCTIONS FOR MUTATION CONTROL (SERVICE ROLE CALLED ONLY)
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.process_credit_transaction(
    target_wallet_uuid uuid,
    amount_tx decimal(12, 2),
    tx_type text,
    description text,
    ref_id text
) returns decimal as $$
declare
    current_balance decimal;
    new_balance decimal;
begin
    -- Select with locking
    select balance into current_balance from public.credit_wallets where organization_id = target_wallet_uuid for update;
    
    if current_balance is null then
        insert into public.credit_wallets (organization_id, balance, promo_balance)
        values (target_wallet_uuid, 0.00, 0.00);
        current_balance := 0.00;
    end if;

    new_balance := current_balance + amount_tx;

    -- Block negative wallet balances for custom debits
    if new_balance < 0.00 then
        raise exception 'Transaction rejected: insufficient credits. Balance is %, attempted debit (%)', current_balance, amount_tx;
    end if;

    -- Update balance
    update public.credit_wallets
    set balance = new_balance, updated_at = now()
    where organization_id = target_wallet_uuid;

    -- Record ledger entry
    insert into public.credit_ledger (wallet_id, type, amount, balance_after, description, reference_id)
    values (target_wallet_uuid, tx_type, amount_tx, new_balance, description, ref_id);

    return new_balance;
end;
$$ language plpgsql security definer;
