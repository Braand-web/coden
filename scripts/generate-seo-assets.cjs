const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const siteUrl = 'https://coden.fun';
const routePolicy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'public-route-policy.json'), 'utf8'));

const existingPages = [
  { file: 'index.html', path: '/', title: 'Coden — Créez une application web avec l’IA', description: 'Décrivez votre idée, créez une application web avec l’IA, prévisualisez-la, ajustez-la puis publiez votre projet avec Coden.' },
  { file: 'pricing.html', path: '/pricing.html', title: 'Tarifs Coden — Offres et crédits en FCFA', description: 'Comparez les offres Coden, les crédits inclus, les droits de publication et les domaines personnalisés. Tarifs affichés en FCFA.' },
  { file: 'features.html', path: '/features.html', title: 'Fonctionnalités Coden — Créer une application web', description: 'Découvrez comment créer, prévisualiser, modifier et publier une application web avec Coden.' },
  { file: 'documentation.html', path: '/documentation.html', title: 'Guide Coden — Créer une application web avec l’IA', description: 'Apprenez à décrire votre application, choisir le mode adapté, vérifier l’aperçu et préparer la publication avec Coden.' },
  { file: 'security.html', path: '/security.html', title: 'Sécurité Coden — Comptes, projets et publication', description: 'Consultez les informations de Coden sur la protection des comptes, projets, secrets, aperçus et publications.' },
  { file: 'privacy.html', path: '/privacy.html', title: 'Confidentialité Coden — Données et projets', description: 'Consultez les données traitées par Coden pour les comptes, prompts, projets, paiements et publications.' },
  { file: 'terms.html', path: '/terms.html', title: 'Conditions Coden — Comptes, crédits et projets', description: 'Consultez les conditions d’utilisation de Coden et les règles relatives aux comptes, crédits, projets et publications.' },
];

const noindexPages = [
  { file: 'auth.html', path: '/auth.html', title: 'Connexion à Coden', description: 'Connectez-vous à Coden pour retrouver vos projets et poursuivre la création de vos applications web.' },
  { file: 'dashboard.html', path: '/dashboard.html', title: 'Coden — Mes projets', description: 'Retrouvez vos projets et gérez votre espace de travail privé dans Coden.' },
  { file: 'builder.html', path: '/builder.html', title: 'Éditeur Coden', description: 'Espace privé pour créer, prévisualiser et modifier vos applications web avec Coden.' },
  { file: 'admin.html', path: '/admin.html', title: 'Coden — Administration', description: 'Console d’administration privée de Coden.' },
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
    h1: 'Créer et améliorer une application web avec Coden',
    subtitle: 'Décrivez votre besoin, examinez l’aperçu puis faites évoluer votre application dans un même espace.',
    sections: [
      ['Décrire le besoin', 'Précisez les personnes concernées, le problème à résoudre et les principales étapes de l’application. Coden peut clarifier la demande avant de modifier le projet.'],
      ['Construire et prévisualiser', 'Coden génère les fichiers du projet. Consultez l’aperçu, examinez le code et demandez des modifications ciblées au fil de la conversation.'],
      ['Vérifier et publier', 'Testez le résultat avant de le rendre public. La publication est une action distincte de l’aperçu et dépend des droits de votre formule.']
    ]
  },
  'documentation.html': {
    h1: 'Guide pratique pour créer une application avec Coden',
    subtitle: 'Les repères essentiels pour décrire votre projet, choisir un mode de travail et vérifier le résultat.',
    sections: [
      ['Choisir un mode', 'Utilisez Auto pour laisser Coden orienter la demande. Choisissez Plan lorsque le périmètre reste à préciser, puis Build lorsque les changements attendus sont assez clairs.'],
      ['Décrire votre application', 'Indiquez le public visé, le parcours principal, les écrans, les données et le style recherché. Précisez aussi les éléments qui doivent rester inchangés.'],
      ['Vérifier avant publication', 'Examinez l’aperçu et testez les interactions principales. Les changements préparés dans le Builder ne remplacent pas la version publiée avant votre action de publication.']
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
    h1: 'Sécurité et contrôle de vos projets Coden',
    subtitle: 'Repères sur la confidentialité des projets, la gestion des secrets et la publication des applications.',
    sections: [
      ['Projets et accès', 'Gardez vos identifiants confidentiels et partagez un projet uniquement avec les personnes qui doivent y accéder. Les espaces privés et les applications publiées répondent à des usages distincts.'],
      ['Clés et secrets', 'Ne placez pas de clé privée dans le code exécuté par le navigateur. Configurez les identifiants d’intégration dans les paramètres prévus à cet effet et vérifiez les permissions accordées.'],
      ['Aperçu et publication', 'L’aperçu sert à examiner les changements avant leur mise en ligne. La publication est séparée et met à jour l’application publique après validation de la demande.']
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
  <meta name="theme-color" content="#FFFFFF" />`;
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
  <meta property="og:image" content="${siteUrl}/og-coden.png" />
  <meta property="og:image:alt" content="Coden — Transformez une idée en application web" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(page.title)}" />
  <meta name="twitter:description" content="${esc(page.description)}" />
  <meta name="twitter:image" content="${siteUrl}/og-coden.png" />
  <meta name="twitter:image:alt" content="Coden — Transformez une idée en application web" />
${schema.map(jsonLd).join('\n')}`;
}

/*
 * The footer this writes into every page, and what it must not be.
 *
 * It used to emit four columns — Product, Resources, Company — listing
 * /features.html, /pricing.html and /documentation.html by hand. `prebuild`
 * runs this on every single build, and `updateExistingFooter` rewrites the
 * `<footer>` of each existing page with the result, so any correction made in
 * the HTML was undone the next time anyone built. That is why the old
 * navigation kept coming back.
 *
 * It now emits what the application renders: the year, and the legal links,
 * both read from the route policy rather than typed here. The served HTML and
 * what a visitor sees are the same thing again — which matters, because the
 * React mount deletes this element and a crawler without JavaScript does not.
 */
const LOGO_MARK = '<span class="coden-logo-mark" data-coden-logo aria-hidden="true"><svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="var(--foreground)"/><path d="M16 8L25 13.5V14.5L16 9.5L7 14.5V13.5L16 8Z" fill="var(--background)"/><path d="M7 16.5V24.5L11.5 22V14L7 16.5Z" fill="var(--background)"/><path d="M25 16.5V24.5L16 24.5V22H20.5V14L25 16.5Z" fill="var(--background)"/></svg></span>';

function sharedPublicFooter(className = 'footer') {
  const legal = (routePolicy.nav?.legal || [])
    .map(link => `                <a href="${link.href}">${esc(link.label.fr || link.label.en)}</a>`)
    .join('\n');
  /*
   * The brand mark stays in the served HTML.
   *
   * The React header draws it, but it draws it in the browser: a crawler, or
   * anyone without JavaScript, saw a page with no logo and no link home once
   * the legacy static navs were removed. `seo-check` asserts exactly that, and
   * caught it. One link, no menu — the menu is the header's job.
   */
  return `    <footer class="${className} coden-site-footer">
        <div class="coden-site-footer-bottom">
            <span><a href="/" class="coden-site-footer-brand" aria-label="Accueil Coden">${LOGO_MARK}</a> @coden${new Date().getFullYear()}</span>
            <span>
${legal}
            </span>
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
  let html = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const url = `${siteUrl}${page.path}`;
  const markerStart = '  <!-- CODEN_SEO_START -->';
  const markerEnd = '  <!-- CODEN_SEO_END -->';
  const isPrivatePage = noindexPages.some(item => item.file === page.file);
  const robots = isPrivatePage ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow" />';
  const socialImage = `${siteUrl}/og-coden.png`;
  const socialImageAlt = 'Coden — Transformez une idée en application web';
  const socialImageType = 'image/png';
  const schema = isPrivatePage ? [] : [{
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'Coden',
        url: `${siteUrl}/`,
        logo: { '@type': 'ImageObject', url: `${siteUrl}/favicon-512x512.png` },
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: 'Coden',
        url: `${siteUrl}/`,
        inLanguage: 'fr-FR',
        publisher: { '@id': `${siteUrl}/#organization` },
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: 'fr-FR',
        isPartOf: { '@id': `${siteUrl}/#website` },
        about: { '@id': `${siteUrl}/#organization` },
      },
      ...(page.path === '/' ? [] : [{
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: ({
            '/pricing.html': 'Tarifs',
            '/features.html': 'Fonctionnalités',
            '/documentation.html': 'Documentation',
            '/security.html': 'Sécurité',
            '/privacy.html': 'Confidentialité',
            '/terms.html': 'Conditions',
          })[page.path] || page.title, item: url },
        ],
      }]),
    ],
  }];
  const socialTags = isPrivatePage ? [] : [
    '  <meta property="og:type" content="website" />',
    '  <meta property="og:locale" content="fr_FR" />',
    '  <meta property="og:site_name" content="Coden" />',
    `  <meta property="og:title" content="${esc(page.title)}" />`,
    `  <meta property="og:description" content="${esc(page.description)}" />`,
    `  <meta property="og:url" content="${url}" />`,
    `  <meta property="og:image" content="${socialImage}" />`,
    `  <meta property="og:image:alt" content="${socialImageAlt}" />`,
    `  <meta property="og:image:type" content="${socialImageType}" />`,
    '  <meta property="og:image:width" content="1200" />',
    '  <meta property="og:image:height" content="630" />',
    '  <meta name="twitter:card" content="summary_large_image" />',
    `  <meta name="twitter:title" content="${esc(page.title)}" />`,
    `  <meta name="twitter:description" content="${esc(page.description)}" />`,
    `  <meta name="twitter:image" content="${socialImage}" />`,
    `  <meta name="twitter:image:alt" content="${socialImageAlt}" />`,
  ];
  const block = [
    markerStart,
    `  <meta name="description" content="${esc(page.description)}" />`,
    `  ${robots}`,
    `  <link rel="canonical" href="${url}" />`,
    ...faviconHead().split('\n'),
    ...socialTags,
    ...schema.map(jsonLd),
    markerEnd,
  ].join('\n');
  const readAttribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]?.toLowerCase() || '';
  html = html.replace(/<html\b([^>]*)>/i, (_match, attrs) => {
    const nextAttrs = /\blang\s*=\s*(["'])[^"']*\1/i.test(attrs)
      ? attrs.replace(/\blang\s*=\s*(["'])[^"']*\1/i, 'lang="fr"')
      : `${attrs} lang="fr"`;
    return `<html${nextAttrs}>`;
  });
  html = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, head => {
    const preservedBlocks = [];
    let cleanHead = head
      .replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, 'g'), '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, block => {
        // HTML-looking strings inside inline app scripts are code, not head
        // metadata. Keep those blocks intact while normalizing actual tags.
        const openingTag = block.slice(0, block.indexOf('>') + 1);
        if (/^<script\b/i.test(openingTag) && /\btype\s*=\s*(["'])application\/ld\+json\1/i.test(openingTag)) return '';
        const placeholder = `__CODEN_SEO_PRESERVED_${preservedBlocks.length}__`;
        preservedBlocks.push(block);
        return placeholder;
      })
      .replace(/<meta\b[^>]*>/gi, tag => {
        const name = readAttribute(tag, 'name');
        const property = readAttribute(tag, 'property');
        return ['description', 'robots', 'theme-color'].includes(name) || name.startsWith('twitter:') || property.startsWith('og:') || property.startsWith('twitter:') ? '' : tag;
      })
      .replace(/<link\b[^>]*>/gi, tag => {
        const rel = readAttribute(tag, 'rel').split(/\s+/);
        return rel.some(value => ['canonical', 'icon', 'apple-touch-icon', 'manifest'].includes(value)) ? '' : tag;
      })
      .replace(/^[\t ]*\n/gm, '');
    preservedBlocks.forEach((block, index) => {
      cleanHead = cleanHead.replace(`__CODEN_SEO_PRESERVED_${index}__`, block);
    });
    cleanHead = cleanHead.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${esc(page.title)}</title>`);
    return cleanHead.replace(/<\/title>/i, match => `${match}\n${block}`);
  });
  fs.writeFileSync(full, html, 'utf8');
}

function updateExistingFooter(page) {
  const full = path.join(root, page.file);
  if (!fs.existsSync(full)) return;
  let html = fs.readFileSync(full, 'utf8');
  /*
   * Matches what this writes, not only what it replaced.
   *
   * The guard used to test for `class="footer"` with its closing quote, so the
   * moment the emitted footer carried a second class the generator stopped
   * recognising its own output and returned early — it could rewrite a page
   * exactly once, and every correction after that silently did nothing.
   */
  const footer = /[ \t]*<footer class="footer[^"]*"[\s\S]*?<\/footer>/;
  if (!footer.test(html)) return;
  html = html.replace(footer, sharedPublicFooter('footer'));
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
  // favicon.svg and og-coden.* are brand assets drawn from src/lib/coden-logo.ts
  // and committed; this script must not redraw them in other colours.
  write('public/robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${siteUrl}/sitemap.xml\n`);
  write('public/llms.txt', `# Coden\n\nCoden est un outil de création d’applications web assistée par IA. Il permet de décrire un projet, d’en générer les fichiers, de consulter un aperçu et, selon l’offre et la configuration, de publier une application.\n\n## Pages publiques\n- Accueil : ${siteUrl}/\n- Tarifs : ${siteUrl}/pricing.html\n- Fonctionnalités : ${siteUrl}/features.html\n- Documentation : ${siteUrl}/documentation.html\n- Sécurité : ${siteUrl}/security.html\n- Confidentialité : ${siteUrl}/privacy.html\n- Conditions : ${siteUrl}/terms.html\n\n## Repères\n- Les projets et espaces de travail des utilisateurs ne sont pas des pages publiques destinées à l’indexation.\n- Les tarifs et droits applicables sont ceux affichés dans l’application au moment de la souscription.\n- Les fonctionnalités dépendent de l’offre, de la configuration du projet et des services connectés.\n`);
  write('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n')}\n</urlset>\n`);
  write('public/_redirects', `${Object.entries(routePolicy.redirects).map(([from, to]) => `${from} ${to} 301`).join('\n')}\n`);
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
