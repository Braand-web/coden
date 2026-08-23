export const CODEN_SEO_CONTRACT_VERSION = 'coden-seo-contract-v1';

export const CODEN_SEO_CONTRACT = [
  `SEO contract version: ${CODEN_SEO_CONTRACT_VERSION}.`,
  'Every generated public page must ship real SEO metadata, never the template defaults ("Coden App", "Lovable Generated Project", "Vite + React").',
  'Required in <head>: unique <title> under 60 chars including the primary keyword; <meta name="description"> under 160 chars; matching og:title, og:description, og:type, twitter:card; canonical link; responsive viewport.',
  'HTML structure: one <h1> per page, semantic landmarks (header, main, nav, footer, article, section), descriptive link text, alt text on every non-decorative image, lazy loading on below-the-fold media.',
  'Add JSON-LD structured data only when it truthfully applies (Organization, Product, Article, FAQ, BreadcrumbList).',
  'Do not place <noscript><img></noscript> tracking pixels inside <head>; <noscript> in <head> may only contain metadata tags (<link>, <style>, <meta>). Put pixel fallbacks in <body>.',
  'Do not fabricate og:image URLs; only set one for a user-provided absolute https URL.',
].join('\n');
