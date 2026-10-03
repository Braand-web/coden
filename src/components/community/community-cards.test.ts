import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardSkeleton, ListingCard, TemplateCard } from './community-cards';
import type { CardListing, Template } from '../../lib/community-client';

const listing: CardListing = {
  id: 'listing-1', title: 'Atelier Lumière', description: 'Une app de démonstration', category: 'design', tags: [],
  creator: 'Lina', creatorProfile: null, remixable: true, thumbnail: 'https://example.com/preview.webp',
  thumbnailAlt: 'Aperçu de Atelier Lumière', featured: true, likes: 24, remixes: 7, listedAt: null,
};
const template: Template = {
  slug: 'atelier-lumiere', title: 'Atelier Lumière', description: 'Une boutique créative prête à personnaliser', category: 'e-commerce',
  version: 1, min_plan: 'free', use_count: 4, likes: 7, liked: false, official: true, available: true,
  kind: 'app', thumbnail: '/community-templates/atelier-lumiere.webp', previewUrl: 'https://preview.example.test',
};

describe('Community project cards', () => {
  it('uses the Dashboard project-card frame and only the compact project caption', () => {
    const html = renderToStaticMarkup(React.createElement(ListingCard, { listing, href: '#listing-1' }));

    expect(html).toContain('coden-dashboard-project-card');
    expect(html).toContain('coden-dashboard-project-card-link');
    expect(html).toContain('coden-dashboard-project-preview');
    expect(html).toContain('coden-dashboard-project-card-meta');
    expect(html).toContain('Atelier Lumière');
    expect(html).toContain('Par Lina');
    expect(html).not.toContain('coden-community-pill');
    expect(html).not.toContain('Choix de Coden');
    expect(html).not.toContain('coden-community-meta');
    expect(html).not.toContain('coden-community-count');
  });

  it('reserves the same card geometry while Community projects load', () => {
    const html = renderToStaticMarkup(React.createElement(CardSkeleton, { project: true }));
    expect(html).toContain('coden-dashboard-project-card');
    expect(html).toContain('coden-dashboard-project-preview');
    expect(html).toContain('coden-dashboard-project-card-meta');
  });

  it('renders templates in the same project-card shell with working like, remix and preview controls', () => {
    const html = renderToStaticMarkup(React.createElement(TemplateCard, {
      template, busy: false, likeBusy: false, onUse: () => undefined, onUpgrade: () => undefined, onToggleLike: () => undefined,
    }));

    expect(html).toContain('coden-dashboard-project-card');
    expect(html).toContain('coden-dashboard-project-preview');
    expect(html).toContain('coden-dashboard-project-card-meta');
    expect(html).toContain('Atelier Lumière');
    expect(html).toContain('7');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Remixer');
    expect(html).toContain('Aperçu');
    expect(html).not.toContain('coden-community-pill');
    expect(html).not.toContain('App complète');
  });

  it('shows the selected like state and a real upgrade action when a template is plan-gated', () => {
    const html = renderToStaticMarkup(React.createElement(TemplateCard, {
      template: { ...template, kind: 'brief', liked: true, available: false }, busy: false, likeBusy: false,
      onUse: () => undefined, onUpgrade: () => undefined, onToggleLike: () => undefined,
    }));

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Voir les offres');
    expect(html).not.toContain('Utiliser');
  });
});
