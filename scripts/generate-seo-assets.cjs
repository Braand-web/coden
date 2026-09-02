const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const siteUrl = 'https://coden.fun';
const now = new Date().toISOString().slice(0, 10);
const routePolicy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'public-route-policy.json'), 'utf8'));

const existingPages = [
  { file: 'index.html', path: '/', title: 'Coden — Turn an idea into a web app with AI', description: 'Describe your idea, create a working web app with AI, preview it, improve it, and publish it after verification.' },
  { file: 'pricing.html', path: '/pricing.html', title: 'Coden Pricing — Build, preview and publish web apps', description: 'Choose a Coden plan to turn ideas into web apps, preview changes, improve projects and publish verified applications.' },
  { file: 'features.html', path: '/features.html', title: 'Coden Features — Plan, Build, Database, Preview and Deploy', description: 'Explore Coden features for AI-native app building: Plan/Build chat, Supabase-ready database, responsive preview, analytics and deployment.' },
  { file: 'documentation.html', path: '/documentation.html', title: 'Coden Documentation — Build Production Apps With AI', description: 'Learn how to use Coden to plan, generate, preview, fix, export and deploy AI-built web apps.' },
  { file: 'security.html', path: '/security.html', title: 'Coden Security — Safer AI App Generation', description: 'Security practices for Coden projects, generated apps, secrets, billing and deployment workflows.' },
  { file: 'privacy.html', path: '/privacy.html', title: 'Coden Privacy — Data and Project Privacy', description: 'How Coden handles prompts, project files, assets, analytics and workspace data.' },
  { file: 'terms.html', path: '/terms.html', title: 'Coden Terms - Product Terms and Usage Rules', description: 'Terms for using Coden to generate, preview, iterate and publish web apps.' },
];

const noindexPages = [
  { file: 'auth.html', path: '/auth.html', title: 'Coden — Continue building your web app', description: 'Sign in to Coden to continue turning your idea into a working web app, preview changes and publish verified projects.' },
  { file: 'dashboard.html', path: '/dashboard.html', title: 'Coden — Mes projets', description: 'Votre espace de travail privé Coden.' },
  { file: 'builder.html', path: '/builder.html', title: 'Coden — Builder Workspace', description: 'Your private Coden builder workspace.' },
  { file: 'checkout.html', path: '/checkout.html', title: 'Coden — Secure Checkout', description: 'Review your Coden plan before secure payment.' },
  { file: 'admin.html', path: '/admin.html', title: 'Coden — Admin Console', description: 'Private Coden administration console.' },
];

const existingPageCopy = {
  'about.html': {
    h1: 'About Coden',
    subtitle: 'Coden helps people move from idea to usable web app with an AI agent that can answer, plan, build, verify, iterate and publish.',
    sections: [
      ['Why Coden exists', 'Most people do not fail because they lack ideas. They fail because turning an idea into a working product is slow, fragmented and intimidating. Coden is built to make that first product loop clearer: explain the goal, inspect the context, generate the app, verify it, improve it and publish only when the owner chooses.'],
      ['What makes it different', 'Coden is product-led instead of demo-led. The builder keeps the chat, preview, project files, database notes, usage and publish workflow together so non-technical founders and teams can understand what is happening without pretending to be engineers.'],
      ['How we build trust', 'The agent is designed to ask before acting when intent is unclear, keep published apps stable until Publish is clicked, avoid exposing internal costs or provider data, and make generated output inspectable instead of mysterious.']
    ]
  },
  'features.html': {
    h1: 'Features Built Around Real Product Work',
    subtitle: 'Plan, generate, verify, iterate and publish web apps from one workspace without losing the thread.',
    sections: [
      ['Agent that understands intent', 'Coden separates conversation, strategy, planning, editing, debugging, generation and publishing. Simple questions stay fast. Real build requests trigger the deeper workflow. Ambiguous requests get one useful clarification before files change.'],
      ['Builder workspace', 'The workspace keeps chat, streaming steps, preview, code, database notes, analysis and publish status together. Users can see what changed, stop a generation, continue iterating and keep the live app stable until they publish.'],
      ['Quality and launch flow', 'Generated apps are checked for safe paths, usable preview output, basic SEO structure, responsive behavior and obvious runtime issues. Coden then supports publish status, Coden-domain URLs, custom-domain planning and free-plan attribution.']
    ]
  },
  'documentation.html': {
    h1: 'Coden Documentation',
    subtitle: 'A practical guide to getting clear results from Coden: when to chat, when to plan, when to build and when to publish.',
    sections: [
      ['Start with the right intent', 'Use Auto when you want Coden to decide whether to answer, plan or build. Use Plan when scope is unclear. Use Build when the app, page, API or UI change is specific enough to safely modify project files.'],
      ['Write better prompts', 'Describe the target user, the primary workflow, required screens, data objects, integrations, visual mood and what must not be changed. Coden can ask follow-up questions when the prompt is too vague.'],
      ['Iterate safely', 'After generation, ask for focused edits like button color, layout density, mobile behavior or form validation. Preview can change freely, but the published app changes only after you click Publish.']
    ]
  },
  'enterprise.html': {
    h1: 'Coden for Teams',
    subtitle: 'A governed AI app-building workspace for product teams, agencies and organizations that need faster prototypes without losing control.',
    sections: [
      ['Shared product workflow', 'Teams can use Coden to turn briefs into prototypes, review generated screens, inspect database direction, publish controlled versions and keep conversations tied to the project context.'],
      ['Governance and visibility', 'Usage, model rates, wallet buckets, publish status and project history are designed to stay visible to the right users while internal provider costs and sensitive details remain protected.'],
      ['Team-ready support', 'Coden is built for workflows that need review, iteration, custom domains, role-aware access and practical audit trails before generated apps become public.']
    ]
  },
  'security.html': {
    h1: 'Security and Trust',
    subtitle: 'Coden keeps the public product experience useful while protecting secrets, internal costs and provider details from user-facing surfaces.',
    sections: [
      ['Sensitive data boundaries', 'User endpoints must never expose provider cost, platform margin, Stripe fees, raw provider payloads, supplier invoice IDs or secrets. Admin-only data stays behind protected roles.'],
      ['Safer generated output', 'The builder checks generated paths, blocks dangerous filenames, avoids committing environment files and treats external keys as explicit user-controlled configuration.'],
      ['Auth, publish and ownership', 'Published apps remain separate from builder preview, free apps can show Coden attribution, and owner-aware links route owners back to the builder while public visitors reach Coden landing.']
    ]
  },
  'showcase.html': {
    h1: 'Built With Coden',
    subtitle: 'A place for real app examples, launch stories and product workflows created with Coden.',
    sections: [
      ['Proof over claims', 'A strong showcase should explain what each app does, who it serves, what workflow was generated and whether it is preview-only, published or using a custom domain.'],
      ['Opt-in visibility', 'Private projects should stay private. Showcase entries should be explicit, owner-approved and useful for people evaluating what Coden can actually produce.'],
      ['Better discovery', 'Each public example can carry clean metadata, screenshots, app summaries and links back to the builder when the owner wants to share the process.']
    ]
  },
  'blog.html': {
    h1: 'Coden Notes',
    subtitle: 'Product lessons, build patterns and practical guidance for creating better AI-generated apps.',
    sections: [
      ['Building with intent', 'Good AI app building starts before code: clarify the user, workflow, platform type, data model and quality bar. Coden is being shaped around that product discipline.'],
      ['Design without generic AI tells', 'We write about UI patterns that make generated apps feel specific: platform-aware layouts, useful states, readable hierarchy, honest placeholders and restrained motion.'],
      ['Reliability over novelty', 'The most valuable AI builder is the one users can trust. That means fewer accidental builds, better verification, persistent conversations and publish flows that do not surprise people.']
    ]
  },
  'community.html': {
    h1: 'Coden Community',
    subtitle: 'A community for founders, designers, agencies and builders learning how to ship useful AI-generated products.',
    sections: [
      ['Share what works', 'Community examples should focus on prompts, decisions, iterations and publish outcomes so other builders can learn from real product loops.'],
      ['Improve the agent', 'Feedback on bad generations, missed intent, broken previews or confusing copy helps Coden improve through safe product signals rather than storing sensitive data.'],
      ['Build in public carefully', 'Coden should make it easy to share public outcomes while keeping private projects, credentials and unfinished experiments protected.']
    ]
  },
  'careers.html': {
    h1: 'Careers at Coden',
    subtitle: 'Help build an AI app builder that feels useful, trustworthy and understandable for people who do not live in code.',
    sections: [
      ['Product taste matters', 'We care about systems that know when not to act, interfaces that explain themselves, and generated apps that are functional before they are flashy.'],
      ['Engineering with restraint', 'The work spans agents, streaming, preview, publish, design systems, billing safety, auth and reliability. Stability matters more than adding another decorative layer.'],
      ['Who fits here', 'Designers, engineers and operators who enjoy product detail, clear UX writing, pragmatic security and fast iteration will feel at home.']
    ]
  },
  'api-reference.html': {
    h1: 'API Reference',
    subtitle: 'Public and internal API surfaces for projects, generation, usage, billing, publish and agent runs.',
    sections: [
      ['User-safe responses', 'User-facing endpoints should return credits, status, project data and actionable errors without leaking provider costs, margins, raw payloads, exact sensitive tokens or internal invoices.'],
      ['Agent and project flow', 'Generation and streaming endpoints carry intent, progress, files changed, verification, preview-ready and cancellation events so the UI can show real work instead of generic loading.'],
      ['Publish workflow', 'Publishing is separate from preview. The live version updates only after a successful Publish call, and publish status should include the final URL, visibility and domain configuration.']
    ]
  }
};

const generatedPageCatalog = [
  {
    slug: 'guides',
    title: 'Coden Guides — AI App Builder Playbooks',
    description: 'Practical guides for building SaaS MVPs, landing pages, dashboards, internal tools and SEO-ready apps with AI.',
    h1: 'Guides for shipping better AI-built apps',
    prompt: 'Plan the best build sequence for a SaaS MVP with landing page, auth, dashboard, database and SEO.',
    cards: ['Build SaaS MVPs with AI.', 'Create SEO landing pages.', 'Use Supabase with generated apps.'],
    faq: ['Do these guides connect to the builder?', 'Yes. Each guide includes a prompt handoff to start Plan or Build in Coden.'],
  },
  {
    slug: 'guides/build-saas-mvp-with-ai',
    title: 'How to Build a SaaS MVP With AI',
    description: 'A practical Coden guide for planning and generating a SaaS MVP with landing page, dashboard, database and deployment path.',
    h1: 'Build a SaaS MVP with fewer dead ends',
    prompt: 'Plan and then build a SaaS MVP with homepage, onboarding, dashboard, billing-ready settings and Supabase schema.',
    cards: ['Start with a narrow workflow.', 'Generate the landing page and app shell together.', 'Use preview, quality checks and database view before publish.'],
    faq: ['Should I Plan or Build first?', 'Use Plan when scope is not clear. Use Build when the first version can be generated safely.'],
  },
  {
    slug: 'guides/supabase-app-builder',
    title: 'Supabase App Builder With AI',
    description: 'Use Coden to generate Supabase-ready web apps with schema notes, project database visibility and secure secret handling.',
    h1: 'Build Supabase-ready apps with AI',
    prompt: 'Create a Supabase-ready app with auth screens, schema.sql, dashboard, database tab and secure API key placeholders.',
    cards: ['Schema notes in generated files.', 'Database visibility inside builder.', 'Secrets stay server-side.'],
    faq: ['Does Coden create real Supabase projects per app?', 'The MVP uses shared Supabase isolation by project and organization, with premium dedicated options planned.'],
  },
  {
    slug: 'tools/prompt-to-app-idea',
    title: 'Prompt to App Idea Generator',
    description: 'Turn a rough product idea into a focused Coden prompt for building an app, dashboard, marketplace or landing page.',
    h1: 'Turn a vague idea into a usable prompt',
    prompt: 'Turn my idea into a clear app build prompt with target users, key screens, data model and launch page.',
    cards: ['Clarify target users.', 'Define screens and data.', 'Start Plan mode before building.'],
    faq: ['Should I start with a short prompt?', 'Yes. Coden can ask follow-up questions when the idea needs more precision.'],
  },
  {
    slug: 'tools/landing-page-score',
    title: 'Landing Page Score Tool for AI Builders',
    description: 'Score a landing page idea for clarity, conversion, SEO structure and differentiation before generating it with Coden.',
    h1: 'Score the landing page before you build it',
    prompt: 'Score this landing page idea for conversion, SEO, audience clarity and design differentiation before building.',
    cards: ['Positioning clarity.', 'SEO intent coverage.', 'Conversion CTA quality.'],
    faq: ['Does this replace analytics?', 'No. It helps before launch; the Analysis tab tracks real project traffic after preview or publish.'],
  },
  {
    slug: 'built-with-coden',
    title: 'Built With Coden — AI-Generated App Showcase',
    description: 'A public showcase strategy for apps, landing pages and dashboards generated with Coden.',
    h1: 'A showcase built for proof and backlinks',
    prompt: 'Create a showcase page for apps built with Coden, grouped by industry, workflow and launch status.',
    cards: ['Showcase published apps.', 'Explain what each app proves.', 'Build authority through real examples.'],
    faq: ['Will every app be public?', 'No. Published showcase pages should be opt-in so private projects remain private.'],
  },
  {
    slug: 'prompt-recipes/restaurant-app',
    title: 'Restaurant App Prompt Recipe',
    description: 'A ready-to-use prompt for creating a restaurant app with menu, reservations, reviews, local SEO and mobile-first design.',
    h1: 'Prompt recipe: restaurant app',
    prompt: 'Create a restaurant app with menu, reservations, reviews, map section, local SEO, photo-forward homepage and mobile checkout-style booking flow.',
    cards: ['Designed for local search.', 'Includes conversion paths.', 'Good fit for Plan or Build.'],
    faq: ['Can I edit the recipe?', 'Yes. Click Build or Plan, then adjust the prompt inside Coden before submitting.'],
  },
  {
    slug: 'prompt-recipes/saas-dashboard',
    title: 'SaaS Dashboard Prompt Recipe',
    description: 'A Coden prompt recipe for creating a SaaS dashboard with analytics, customer data, settings and Supabase-ready schema.',
    h1: 'Prompt recipe: SaaS dashboard',
    prompt: 'Create a SaaS dashboard with KPI overview, customer table, subscriptions, account settings, team roles, audit log and Supabase schema.sql.',
    cards: ['Operational UI.', 'Data-ready layout.', 'Good foundation for MVPs.'],
    faq: ['Why include schema.sql?', 'It gives the generated app a clearer backend direction and feeds the Database tab.'],
  },
  {
    slug: 'prompt-recipes/marketplace',
    title: 'Marketplace Prompt Recipe',
    description: 'A prompt recipe for creating an AI-generated marketplace with listings, vendor profiles, search, filters and admin moderation.',
    h1: 'Prompt recipe: marketplace',
    prompt: 'Create a marketplace with listings, vendor profiles, search filters, saved items, checkout placeholders, admin moderation and SEO category pages.',
    cards: ['Search and filtering.', 'Vendor workflows.', 'SEO category pages.'],
    faq: ['Can Coden add payments?', 'Yes, but it will ask for Stripe keys or continue with safe placeholders depending on your choice.'],
  },
];

const generatedPages = generatedPageCatalog.filter(page => !routePolicy.redirects[`/${page.slug.replace(/\/?$/, '/')}`]);

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function titleCase(value) {
  return String(value).split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function pageCategory(page) {
  const slug = page.slug || '';
  if (slug.startsWith('guides')) return 'Guide';
  if (slug.startsWith('tools')) return 'Tool';
  if (slug.startsWith('prompt-recipes')) return 'Prompt recipe';
  if (slug === 'built-with-coden') return 'Showcase';
  return 'AI app builder';
}

function enrichPage(page) {
  const category = pageCategory(page);
  const slug = page.slug || '';
  const defaultWorkflow = [
    'Clarify the user, job-to-be-done and minimum usable workflow before generating.',
    'Create the product surface with real states: empty, loading, error, success and mobile layouts.',
    'Run the project through preview, quality checks and iteration before publish.'
  ];
  const defaultQuality = [
    'A clear first screen that shows the actual product experience, not a generic marketing page.',
    'Accessible typography, visible controls, honest backend placeholders and responsive behavior.',
    'Copy, metadata and internal links shaped for both search engines and AI answer systems.'
  ];

  const byCategory = {
    'Use case': {
      proofTitle: 'What this workflow should prove',
      workflow: defaultWorkflow,
      quality: defaultQuality,
      cta: 'Use this page as a starting point, then open Coden with a focused prompt for your audience and workflow.'
    },
    Guide: {
      proofTitle: 'What the guide should help you decide',
      workflow: ['Define the smallest useful product slice.', 'Choose Plan when scope is unclear and Build when requirements are concrete.', 'Verify the generated app before publishing or handing it to a team.'],
      quality: defaultQuality,
      cta: 'The goal is not more pages; it is a tighter build path with fewer vague prompts and fewer broken previews.'
    },
    Tool: {
      proofTitle: 'What the tool should improve',
      workflow: ['Turn fuzzy product inputs into a sharper brief.', 'Surface risks before generation.', 'Send the refined prompt into Coden when the next action is clear.'],
      quality: ['Clear scoring or prioritization.', 'Actionable next steps, not generic advice.', 'A direct handoff into Plan or Build with the right context.'],
      cta: 'Use the tool to reduce guesswork before asking Coden to generate or edit project files.'
    },
    'Prompt recipe': {
      proofTitle: 'What the prompt should include',
      workflow: ['Name the target user and primary workflow.', 'List the screens, data objects and conversion moments.', 'Ask for functional interactions and states, not only visual sections.'],
      quality: ['Specific UI patterns for the platform type.', 'Realistic mock data and honest integrations.', 'Mobile behavior, accessibility and publish readiness.'],
      cta: 'Edit the recipe before building so Coden understands your product, not just the category.'
    },
    Showcase: {
      proofTitle: 'What the showcase should prove',
      workflow: ['Explain the problem each app solves.', 'Show the generated workflow and publish status.', 'Link back to the build story only when the project owner chooses to share it.'],
      quality: ['Real examples over inflated claims.', 'Clear attribution to Coden for free published apps.', 'Search-friendly summaries that help people understand what was built.'],
      cta: 'A strong showcase should make visitors trust the output because the examples are specific and inspectable.'
    }
  };

  return {
    category,
    ...(byCategory[category] || byCategory['Use case'])
  };
}

function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}</script>`;
}

function faviconHead() {
  return `  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
  <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#0e1116" />`;
}

function baseHead(page, url, breadcrumbs = []) {
  const faqQuestion = page.faq?.[0] || 'Can Coden build this app?';
  const faqAnswer = page.faq?.[1] || 'Yes. Use Plan to refine the idea or Build to generate project files and preview.';
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url,
      isPartOf: { '@type': 'WebSite', name: 'Coden', url: siteUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Coden',
      url: siteUrl,
      logo: `${siteUrl}/favicon.svg`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{
        '@type': 'Question',
        name: faqQuestion,
        acceptedAnswer: { '@type': 'Answer', text: faqAnswer },
      }],
    },
  ];
  if (breadcrumbs.length) {
    schema.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    });
  }

  return `  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(page.title)} | Coden</title>
  <meta name="description" content="${esc(page.description)}" />
  <link rel="canonical" href="${url}" />
${faviconHead()}
  <meta name="robots" content="index, follow" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Coden" />
  <meta property="og:title" content="${esc(page.title)}" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${siteUrl}/og-coden.svg" />
  <meta property="og:image:alt" content="Coden — AI app builder for building and publishing web apps" />
  <meta property="og:image:type" content="image/svg+xml" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.title)}" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="twitter:image" content="${siteUrl}/og-coden.svg" />
  <meta name="twitter:image:alt" content="Coden — AI app builder for building and publishing web apps" />
${schema.map(jsonLd).join('\n')}`;
}

function sharedPublicFooter(className = 'footer') {
  if (className === 'footer') {
    return `    <footer class="footer">
        <div class="footer-grid">
            <div class="footer-brand">
                <a href="/" class="logo">
                    <div class="logo-mark">
                        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                            <rect width="32" height="32" rx="8" fill="var(--text)"/>
                            <path d="M16 8L25 13.5V14.5L16 9.5L7 14.5V13.5L16 8Z" fill="var(--bg)"/>
                            <path d="M7 16.5V24.5L11.5 22V14L7 16.5Z" fill="var(--bg)"/>
                            <path d="M25 16.5V24.5L16 24.5V22H20.5V14L25 16.5Z" fill="var(--bg)"/>
                        </svg>
                    </div>
                    <span class="logo-text">Coden</span>
                </a>
                <p>The next generation of <span class="neon-highlight neon-static">AI-native</span> software development.</p>
            </div>
            <div class="footer-col">
                <h5>Product</h5>
                <ul class="footer-links">
                    <li><a href="/features.html">Features</a></li>
                    <li><a href="/pricing.html">Pricing</a></li>
                </ul>
            </div>
            <div class="footer-col">
                <h5>Resources</h5>
                <ul class="footer-links">
                    <li><a href="/documentation.html">Documentation</a></li>
                </ul>
            </div>
            <div class="footer-col">
                <h5>Company</h5>
                <ul class="footer-links">
                    <li><a href="/privacy.html">Privacy</a></li>
                    <li><a href="/security.html">Security</a></li>
                    <li><a href="/terms.html">Terms</a></li>
                </ul>
            </div>
        </div>
        <div class="footer-bottom">
            <span>© 2026 Coden Inc.</span>
            <div style="display:flex;gap:20px;" aria-label="Social links">
                <span style="color:inherit;opacity:.7;">Social profiles coming soon</span>
            </div>
        </div>
    </footer>`;
  }
  const cardClass = className === 'seo-footer' ? 'seo-footer-card' : 'footer-grid';
  const brandClass = className === 'seo-footer' ? 'seo-footer-brand' : 'footer-brand';
  const kickerClass = className === 'seo-footer' ? 'seo-footer-kicker' : 'footer-kicker';
  const contactClass = className === 'seo-footer' ? 'seo-footer-contact' : 'footer-contact';
  const wordmarkClass = className === 'seo-footer' ? 'seo-footer-wordmark' : 'footer-wordmark';
  const colClass = className === 'seo-footer' ? 'seo-footer-col' : 'footer-col';
  const linksClass = className === 'seo-footer' ? 'seo-footer-links' : 'footer-links';
  const bottomClass = className === 'seo-footer' ? 'seo-footer-bottom' : 'footer-bottom';
  const legalClass = className === 'seo-footer' ? 'seo-footer-legal' : 'footer-legal';

  return `    <footer class="${className}" aria-labelledby="footer-title">
        <div class="${cardClass}">
            <div class="${brandClass}">
                <div class="${kickerClass}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"></path>
                        <path d="M19 15l.8 2.7L22 18.5l-2.2.8L19 22l-.8-2.7-2.2-.8 2.2-.8L19 15Z"></path>
                    </svg>
                    Parlons produit
                </div>
                <p id="footer-title">Passez d'une idée floue à une app claire, <span>testable, améliorable et publiable avec Coden.</span></p>
                <div class="${contactClass}">
                    <span>Besoin d'aide, d'un partenariat ou d'un accès équipe ?</span>
                    <a href="mailto:contact@coden.fun">contact@coden.fun</a>
                </div>
                <a class="${wordmarkClass}" href="/" aria-label="Coden home">coden</a>
            </div>
            <div class="${colClass}">
                <h5>Navigation</h5>
                <ul class="${linksClass}">
                    <li><a href="/pricing.html">Tarifs</a></li>
                    <li><a href="/documentation.html">Documentation</a></li>
                    <li><a href="/security.html">Sécurité</a></li>
                    <li><a href="/privacy.html">Confidentialité</a></li>
                    <li><a href="/terms.html">Conditions</a></li>
                    <li><a href="mailto:contact@coden.fun">Contact</a></li>
                </ul>
            </div>
            <div class="${bottomClass}">
                <span>© 2026 Coden. Tous droits réservés.</span>
                <div class="${legalClass}">
                    <a href="/privacy.html">Confidentialité</a>
                    <a href="/security.html">Sécurité</a>
                    <a href="/terms.html">CGU</a>
                    <a href="https://www.coden.fun/">coden.fun</a>
                </div>
            </div>
        </div>
    </footer>`;
}

function renderPage(page) {
  const url = `${siteUrl}/${page.slug.replace(/\/?$/, '/')}`;
  const parent = page.slug.includes('/') ? page.slug.split('/')[0] : page.slug;
  const enriched = enrichPage(page);
  const breadcrumbs = [
    { name: 'Coden', url: `${siteUrl}/` },
    ...(parent !== page.slug ? [{ name: titleCase(parent), url: `${siteUrl}/${parent}/` }] : []),
    { name: titleCase(page.slug), url },
  ];
  return `<!DOCTYPE html>
<html lang="en" data-page="${esc(page.slug)}">
<head>
${baseHead(page, url, breadcrumbs)}
</head>
<body data-coden-surface="marketing">
  <div class="seo-shell">
    <nav class="seo-nav" aria-label="Main navigation">
      <a class="seo-brand" href="/"><span class="seo-brand-mark" data-coden-logo><img src="/favicon.svg" alt="" /></span><span>Coden</span></a>
      <div class="seo-nav-links">
        <a href="/features.html">Features</a>
        <a href="/documentation.html">Documentation</a>
        <a class="seo-pill" href="/pricing.html">Pricing</a>
      </div>
    </nav>
    <main>
      <section class="seo-hero">
        <div>
          <div class="seo-kicker">${esc(enriched.category)} · AI app builder</div>
          <h1>${esc(page.h1)}</h1>
          <p class="seo-lead">${esc(page.description)}</p>
        </div>
        <aside class="seo-panel" data-seo-prompt-form>
          <div class="seo-prompt">
            <label for="seo-prompt-${page.slug.replace(/\W/g, '-')}">Start from this prompt</label>
            <textarea id="seo-prompt-${page.slug.replace(/\W/g, '-')}" data-seo-prompt>${esc(page.prompt)}</textarea>
            <input type="hidden" data-seo-mode value="build" />
            <div class="seo-actions">
              <button class="seo-button" type="button" data-seo-submit>Build with Coden</button>
              <button class="seo-button secondary" type="button" data-seo-mode-button="plan">Plan first</button>
              <button class="seo-button secondary" type="button" data-seo-mode-button="build">Build mode</button>
            </div>
          </div>
        </aside>
      </section>
      <section class="seo-section">
        <h2>${esc(enriched.proofTitle)}</h2>
        <div class="seo-grid">
          ${page.cards.map((card, index) => `<article class="seo-card"><h3>${esc(['Focused prompt', 'Production shape', 'Search-ready structure'][index] || 'Coden advantage')}</h3><p>${esc(card)}</p></article>`).join('\n          ')}
        </div>
      </section>
      <section class="seo-section">
        <h2>How to approach this in Coden</h2>
        <div class="seo-grid">
          ${enriched.workflow.map((item, index) => `<article class="seo-card"><h3>${esc(['Clarify', 'Generate', 'Verify'][index] || 'Iterate')}</h3><p>${esc(item)}</p></article>`).join('\n          ')}
        </div>
      </section>
      <section class="seo-section">
        <h2>Quality bar before publish</h2>
        <div class="seo-grid">
          ${enriched.quality.map((item, index) => `<article class="seo-card"><h3>${esc(['Usable first screen', 'Functional states', 'Findable structure'][index] || 'Launch quality')}</h3><p>${esc(item)}</p></article>`).join('\n          ')}
        </div>
        <p class="seo-lead">${esc(enriched.cta)}</p>
      </section>
      <section class="seo-section">
        <h2>Questions before building</h2>
        <div class="seo-faq">
          <details open><summary>${esc(page.faq[0])}</summary><p>${esc(page.faq[1])}</p></details>
          <details><summary>Should I use Plan or Build?</summary><p>Use Plan when the idea is fuzzy. Use Build when the first version is clear enough to safely generate project files and preview.</p></details>
          <details><summary>How does this help people find the app?</summary><p>Coden gives each generated app clear structure, metadata, useful content prompts and internal links that search engines and AI answer systems can understand.</p></details>
        </div>
      </section>
    </main>
${sharedPublicFooter('seo-footer')}
  </div>
</body>
</html>
`;
}

function write(filePath, content) {
  const full = path.join(root, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function injectHeadMeta(page) {
  const full = path.join(root, page.file);
  if (!fs.existsSync(full)) return;
  let html = fs.readFileSync(full, 'utf8');
  const url = `${siteUrl}${page.path}`;
  const markerStart = '<!-- CODEN_SEO_START -->';
  const markerEnd = '<!-- CODEN_SEO_END -->';
  const robots = noindexPages.some(item => item.file === page.file) ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow" />';
  const schema = page.path === '/'
    ? [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Coden',
        url: siteUrl,
        logo: `${siteUrl}/favicon.svg`,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Coden',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        description: page.description,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Coden AI App Builder',
        description: page.description,
        brand: { '@type': 'Brand', name: 'Coden' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: 'What is Coden?', acceptedAnswer: { '@type': 'Answer', text: 'Coden helps you turn an idea into a working web app, preview it, improve it, and publish it after verification.' } },
          { '@type': 'Question', name: 'Can Coden generate SEO-ready apps?', acceptedAnswer: { '@type': 'Answer', text: 'Coden can help structure generated apps with semantic pages and metadata, then you can inspect and verify the result before publishing.' } },
        ],
      },
    ]
    : [{
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url,
    }];
  const block = `${markerStart}
  <meta name="description" content="${esc(page.description)}" />
  ${robots}
  <link rel="canonical" href="${url}" />
${faviconHead()}
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Coden" />
  <meta property="og:title" content="${esc(page.title)}" />
  <meta property="og:description" content="${esc(page.description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${siteUrl}/og-coden.svg" />
  <meta property="og:image:alt" content="Coden — AI app builder for building and publishing web apps" />
  <meta property="og:image:type" content="image/svg+xml" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.title)}" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="twitter:image" content="${siteUrl}/og-coden.svg" />
  <meta name="twitter:image:alt" content="Coden — AI app builder for building and publishing web apps" />
  ${schema.map(jsonLd).join('\n  ')}
  ${markerEnd}`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`);
  if (html.includes(markerStart)) {
    html = html.replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`), block);
  } else {
    html = html.replace(/<\/title>/, `</title>\n  ${block}`);
  }
  fs.writeFileSync(full, html, 'utf8');
}

function updateExistingFooter(page) {
  // The landing page owns its richer conversion footer and i18n contract.
  // Keep the shared SEO footer for secondary public pages only.
  if (page.file === 'index.html') return;
  const full = path.join(root, page.file);
  if (!fs.existsSync(full)) return;
  let html = fs.readFileSync(full, 'utf8');
  if (!html.includes('<footer class="footer"')) return;
  html = html.replace(/    <footer class="footer"[\s\S]*?    <\/footer>/, sharedPublicFooter('footer'));
  fs.writeFileSync(full, html, 'utf8');
}

function updateExistingPageContent(page) {
  const copy = existingPageCopy[page.file];
  if (!copy) return;
  const full = path.join(root, page.file);
  if (!fs.existsSync(full)) return;
  let html = fs.readFileSync(full, 'utf8');
  const header = `    <header class="page-hero">
        <h1>${esc(copy.h1)}</h1>
        <p class="hero-subtitle">${esc(copy.subtitle)}</p>
    </header>`;
  const content = `    <div class="page-content">
${copy.sections.map(([title, body]) => `        <h2>${esc(title)}</h2>
        <p>${esc(body)}</p>`).join('\n        \n')}
    </div>`;

  html = html.replace(/    <header class="page-hero">[\s\S]*?    <\/header>/, header);
  html = html.replace(/    <div class="page-content">[\s\S]*?    <\/div>/, content);
  fs.writeFileSync(full, html, 'utf8');
}

function generatePublicAssets(urls) {
  write('public/robots.txt', `User-agent: *\nAllow: /\nDisallow: /auth.html\nDisallow: /dashboard.html\nDisallow: /builder.html\nDisallow: /checkout.html\nDisallow: /admin.html\nSitemap: ${siteUrl}/sitemap.xml\n`);
  write('public/llms.txt', `# Coden\n\nCoden is an AI app builder for creating, previewing, iterating and publishing production-ready web apps.\n\n## Important pages\n- Home: ${siteUrl}/\n- Pricing: ${siteUrl}/pricing.html\n- Features: ${siteUrl}/features.html\n- Documentation: ${siteUrl}/documentation.html\n- Security: ${siteUrl}/security.html\n\n## Product facts\n- Coden supports prompt-to-app generation, project preview, database visibility, publishing workflows and model selection.\n- Coden is designed for founders, agencies, product teams and non-technical builders.\n- Private app routes such as auth, dashboard and builder are not intended for indexing.\n`);
  write('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${url}</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>${url === siteUrl + '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')}\n</urlset>\n`);
  write('public/_redirects', `${Object.entries(routePolicy.redirects).map(([from, to]) => `${from} ${to} 301`).join('\n')}\n`);
  write('public/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.icon-bg{fill:#09090b}.icon-fill{fill:#ffffff}@media (prefers-color-scheme:dark){.icon-bg{fill:#ffffff}.icon-fill{fill:#09090b}}</style><rect class="icon-bg" width="32" height="32" rx="8"/><path class="icon-fill" d="M16 8L25 13.5V14.5L16 9.5L7 14.5V13.5L16 8Z"/><path class="icon-fill" d="M7 16.5V24.5L11.5 22V14L7 16.5Z"/><path class="icon-fill" d="M25 16.5V24.5L16 24.5V22H20.5V14L25 16.5Z"/></svg>\n`);
  write('public/og-coden.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#ffffff"/><circle cx="1040" cy="100" r="260" fill="#09090b" opacity=".05"/><circle cx="150" cy="540" r="300" fill="#3b7a8c" opacity=".10"/><rect x="84" y="82" width="1032" height="466" rx="42" fill="#ffffff" stroke="#09090b" stroke-opacity=".12"/><text x="138" y="220" font-family="Arial, sans-serif" font-size="64" font-weight="800" fill="#09090b">Coden</text><text x="138" y="310" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#09090b">Build apps people can use and find.</text><text x="138" y="386" font-family="Arial, sans-serif" font-size="28" fill="#52525b">AI app builder with database, preview, deploy and SEO-ready output.</text></svg>\n`);
}

function main() {
  generatedPages.forEach(page => write(path.join(page.slug, 'index.html'), renderPage(page)));
  existingPages.forEach(updateExistingPageContent);
  existingPages.forEach(updateExistingFooter);
  [...existingPages, ...noindexPages].forEach(injectHeadMeta);
  const urls = [
    ...existingPages.map(page => `${siteUrl}${page.path}`),
    ...generatedPages.map(page => `${siteUrl}/${page.slug.replace(/\/?$/, '/')}`),
  ];
  generatePublicAssets(Array.from(new Set(urls)));
}

main();
