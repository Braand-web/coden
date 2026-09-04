// One-time, explicit conversion of the supplied DC export. Never execute its scripts.
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const old = readFileSync('index.html', 'utf8');
const seo = old.match(/<!-- CODEN_SEO_START -->[\s\S]*?<!-- CODEN_SEO_END -->/)?.[0] || '';
let body = source.split('</helmet>')[1].split('</x-dc>')[0].trim();
let css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
let count = 0;
body = body.replace(/<([a-z][a-z0-9-]*)([^>]*?)\sstyle-(hover|focus-within)="([^"]*)"([^>]*)>/gi,
  (_, tag, before, state, rules, after) => {
    const name = `cdn-interaction-${++count}`;
    let attributes = before + after;
    if (/class="/.test(attributes)) attributes = attributes.replace(/class="/, `class="${name} `);
    else attributes += ` class="${name}"`;
    css += `\n.${name}:${state}{${rules}}`;
    return `<${tag}${attributes}>`;
  });
body = body.replace(/<sc-for as="logo"[\s\S]*?<\/sc-for>/, ['React', 'TypeScript', 'Vite', 'Node.js', 'Supabase', 'GitHub', 'React', 'TypeScript', 'Vite', 'Node.js', 'Supabase', 'GitHub'].map(name => `<span class="cdn-stack-name">${name}</span>`).join(''));
const faqs = [
  ['Do I own the code Coden generates?', 'Your project contains standard source files. You can inspect the code in the Builder and continue working on it as your application grows.'],
  ['Can I connect my own database or Stripe account?', 'You can request integrations such as Supabase or Stripe. Services need their own configuration and credentials; Coden will ask for the information required by your project.'],
  ['What happens when I publish?', 'Preview your application and check the result first. Publishing is a separate action in the Builder, subject to your plan and the deployment configuration.'],
  ['Can Coden follow my existing design system?', 'Attach a reference or provide your styles, tokens and component conventions with your request. Coden can use them while building your interface.'],
  ['Is there a free plan?', 'Yes. Free includes discovery credits to create a first prototype. Paid plans provide additional credits and hosting allowances. See the plan details before subscribing.'],
];
body = body.replace(/<sc-for as="item"[\s\S]*?<\/sc-for>/, faqs.map(([q,a], i) => `<details class="cdn-faq"${i === 0 ? ' open' : ''}><summary>${q}<span aria-hidden="true">⌄</span></summary><p>${a}</p></details>`).join('\n'));
body = body.replace(/<\/?sc-if\b[^>]*>/g, '');
body = body.replace('{{ promptPlaceholder }}', "Describe the app you want to build…");
body = body.replace('style="{{ indicatorStyle }}"', 'class="cdn-billing-indicator"');
body = body.replace('onClick="{{ setMonthly }}" style="{{ monthlyBtnStyle }}"', 'data-billing="monthly" aria-pressed="true" class="cdn-billing-button"');
body = body.replace('onClick="{{ setAnnual }}" style="{{ annualBtnStyle }}"', 'data-billing="annual" aria-pressed="false" class="cdn-billing-button"');
body = body.replace('style="{{ proPriceStyle }}"', 'class="cdn-price" data-plan-price="pro"');
body = body.replace('{{ proPrice }}', '$25').replace('{{ perLabel }}', '<span data-price-period>Per month</span>');
body = body.replace('Teams building with Coden', 'Technologies for your projects');
body = body.replace('Now live: Visual Edits', 'From idea to working application');
body = body.replace('Build any sites and saas in second', 'Describe your idea. Build, preview and refine it with Coden.');
body = body.replace('The best model, every time', 'The right tools for your next idea');
body = body.replace('Coden routes each task to the right model, balancing quality and cost. No juggling platforms or guessing which agent to use.', 'Describe the outcome you want. Coden works with your project, writes code and checks the result in one workspace.');
body = body.replaceAll('>Standard<', '>Auto<').replaceAll('>Max<', '>Plan<').replace('>Pro only<', '>Read-only<');
body = body.replace('Highest intelligence for complex features and large apps.', 'Explore the approach before asking Coden to change your application.');
body = body.replace('>Speed<', '>Purpose<').replace('>Low<', '>Planning<').replace('>Intelligence<', '>Output<').replace('>Very high<', '>A clear approach<').replace('>Token cost<', '>File changes<').replace('>High<', '>None<');
body = body.replace('>98%</p>', '>Build &amp; test</p>').replace('less errors', 'an iterative workflow');
body = body.replace('Coden tests, refactors and iterates automatically, so you keep building instead of fixing.', 'Inspect the preview, review the checks and ask Coden to improve the result.');
body = body.replace('Coden handles projects <strong style="color:#f8fafc;font-weight:600">1,000 times larger</strong> than before, with in-context management that keeps large codebases coherent.', 'Keep your code, conversation and preview together. Make focused changes as your project grows.').replace('>1000x</p>', '>Iterate.</p>');
body = body.replace('Import your tokens once. Coden reads them on every screen it builds, so nothing arrives off-brand.', 'Share your tokens, components and visual references to guide a consistent interface.');
body = body.replace('Stop stitching platforms together. Coden Cloud gives you production infrastructure: hosting, databases, auth and integrations.', 'Build your interface, connect the services your app needs and prepare it for publication from the same workspace.');
body = body.replace('Custom domains, SSL and analytics are wired on publish. Preview builds never touch your live site.', 'Check the working preview before publishing. Deployment options depend on your plan and connected services.');
body = body.replace('Unlimited databases', 'Connected databases').replace('A Postgres instance per project, provisioned the moment you need it.', 'Connect a database when your app needs persistent data.');
body = body.replace('Sign-in, roles and sessions wired from day one.', 'Build sign-in and account flows around your configured authentication provider.');
body = body.replace('Metadata, sitemaps and Core Web Vitals handled on every build.', 'Include metadata and responsive pages, then check your app before launch.');
body = body.replace('Enterprise-grade from the start', 'A workflow you can inspect').replace('SOC 2 posture, full audit trail, SSO and shared team templates on Enterprise.', 'Review project changes, test important flows and keep publication under your control.');
body = body.replace('app.northwind.com', 'app.example.com').replace('studio.coden.app', 'studio.example.com');
body = body.replace('build 9.4s', 'build checks').replace('edge · 3 regions', 'preview → publish');
body = body.replace('>100</span>', '>Check</span>').replace('LCP 0.9s', 'Loading').replace('CLS 0', 'Stability').replace('INP 40ms', 'Interaction');
body = body.replace('Unlimited public projects', 'Discovery credits for a first prototype').replace('Standard model routing', 'AI-assisted generation').replace('coden.app subdomain', 'Unpublished local preview');
body = body.replace('Max model access', '1,000 credits').replace('Private projects &amp; custom domains', '$10 hosting allowance').replace('Databases, auth and analytics', 'Build and improve your applications').replace('Design system import', 'Preview before publishing');
const pricingAt = body.indexOf('<section id="pricing"');
const faqAt = body.indexOf('<section id="faq"');
let pricing = body.slice(pricingAt, faqAt);
pricing = pricing.replace('>Enterprise</p>', '>Scale</p>').replace('>Custom</p>', ' data-plan-price="scale">$200</p>');
pricing = pricing.replace('For teams with compliance needs.', 'For teams shipping multiple applications.').replace('SSO and audit logs', '10,000 credits').replace('Shared team templates', '$75 hosting allowance').replace('Dedicated support', 'More capacity for your projects').replace('Talk to sales', 'Choose Scale');
pricing = pricing.replace('href="/contact.html"', 'href="/auth.html?plan=scale&amp;billing=monthly" data-plan-cta="scale"');
pricing = pricing.replace(/href="\/auth.html"/g, (_, offset) => offset < pricing.indexOf('>Pro</p>') ? 'href="/auth.html?plan=free"' : 'href="/auth.html?plan=pro&amp;billing=monthly" data-plan-cta="pro"');
body = body.slice(0, pricingAt) + pricing + body.slice(faqAt);
// Canonical routes only; do not ship dead marketing destinations.
const routes = { '/blog.html':'/documentation.html', '/community.html':'/documentation.html', '/help.html':'/documentation.html', '/templates.html':'/dashboard.html', '/careers.html':'/documentation.html', '/contact.html':'/documentation.html' };
for (const [from,to] of Object.entries(routes)) body = body.replaceAll(`href="${from}"`, `href="${to}"`);
body = body.replace(/<div style="display:flex;gap:9px">[\s\S]*?<\/div>(\s*<\/div>\s*<\/div>\s*<div style="max-width:1200px;margin:40px)/, '<div><a href="/documentation.html">Documentation &amp; help ↗</a></div>$1');
body = body.replace('href="/auth.html" style="display:inline-flex;', 'href="/dashboard.html" style="display:inline-flex;');
body = body.replaceAll('<textarea ', '<textarea aria-label="Describe your app" maxlength="12000" ');
body = body.replaceAll('aria-label="Attach a file"', 'aria-label="Attach a file" data-prompt-action="upload"');
body = body.replaceAll('aria-label="Build now"', 'aria-label="Build now" data-build');
body = body.replace('                Plan\n', '                <span data-mode-label>Auto</span>\n');
body = body.replace(/(<button type="button")(?= style="display:flex;align-items:center;gap:7px)/, '$1 data-mode-toggle aria-pressed="false" aria-label="Plan before building"');
// The wrappers are wired by the page entrypoint, without legacy global scripts.
body = body.replace('<header ', '<a class="cdn-skip" href="#top">Skip to content</a>\n<header id="coden-marketing-header-root" ');
body = body.replace('<section id="top"', '<main id="landing-main"><section id="top"').replace('<footer ', '</main>\n<footer ');
body = body.replace('href="#top" style="display:inline-flex', 'aria-label="Coden home" href="#top" style="display:inline-flex');
body = body.replace('<section aria-label="Technologies for your projects"', '<section aria-label="Technologies for your projects"');
body = body.replace('<div class="cdn-marquee"', '<p class="cdn-stack-caption">Built with familiar technologies</p><div class="cdn-marquee"');
body = body.replace('<section aria-label="Reliability"', '<section aria-label="Reliability"');
body = body.replace('            GitHub\n', '            A repository\n').replace('            Team template\n', '            A starter idea\n');
body = body.replace('>Blog</a>', '>Documentation</a>').replace('>Community</a>', '>Features</a>').replace('>Help center</a>', '>Getting started</a>').replace('>Templates</a>', '>Your workspace</a>').replace('>Careers</a>', '>Product guide</a>');
body = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (tag, attributes, content) => {
  const kind = /A screenshot\s*$/.test(content) ? 'screenshot' : /A repository\s*$/.test(content) ? 'repository' : /A starter idea\s*$/.test(content) ? 'starter' : null;
  return kind ? `<a${attributes.replace(/href="[^"]*"/, 'href="#top"')} data-start-from="${kind}">${content}</a>` : tag;
});
body = body.replace('<div style="max-width:1200px;margin:0 auto;display:grid;gap:16px">', '<p class="cdn-example-note">Illustrations of the workflow — not live project metrics.</p><div style="max-width:1200px;margin:0 auto;display:grid;gap:16px">');
if (/\{\{|<\/?sc-|style-hover|text\/x-dc/.test(body)) throw new Error('Unconverted DC directive');
body = body.replace(/[ \t]+$/gm, '');
const fonts = source.match(/<link href="https:\/\/fonts.googleapis.com[^>]+>/)[0];
writeFileSync('index.html', `<!DOCTYPE html>\n<html lang="en" data-theme="dark">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Coden — Turn an idea into a web app with AI</title>\n${seo}\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n${fonts}\n<link rel="stylesheet" href="/src/styles/landing-v3.css">\n</head>\n<body data-coden-surface="landing-v3">\n${body}\n<p id="landing-notice" role="status" aria-live="polite" hidden></p>\n<script type="module" src="/src/landing-v3.ts"></script>\n</body>\n</html>\n`);
writeFileSync('src/styles/landing-reference.css', css + '\n');
