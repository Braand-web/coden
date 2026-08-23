export type ProductLocale = 'fr' | 'en';

export type ProductPositioning = {
  heroTitle: string;
  heroSubtitle: string;
  promptPlaceholder: string;
  primaryCta: string;
  secondaryCta: string;
  workflowTitle: string;
  workflowDescription: string;
  previewLabel: string;
  refineLabel: string;
  publishLabel: string;
  seoTitle: string;
  seoDescription: string;
  shortDescription: string;
};

const POSITIONING: Record<ProductLocale, ProductPositioning> = {
  fr: {
    heroTitle: 'De l’idée à l’application web.',
    heroSubtitle: 'Décrivez votre projet. Coden le construit, le vérifie et vous aide à le publier.',
    promptPlaceholder: 'Décrivez l’application que vous voulez créer…',
    primaryCta: 'Créer mon application',
    secondaryCta: 'Voir comment ça fonctionne',
    workflowTitle: 'De l’idée à l’application en ligne.',
    workflowDescription: 'Coden vous accompagne de la première description jusqu’à la preview vérifiée et la publication.',
    previewLabel: 'Prévisualiser l’application',
    refineLabel: 'Affiner avec l’agent',
    publishLabel: 'Publier quand elle est vérifiée',
    seoTitle: 'Coden — Transformez une idée en application web avec l’IA',
    seoDescription: 'Décrivez votre idée, créez une application web fonctionnelle avec l’IA, prévisualisez-la, améliorez-la et publiez-la après vérification.',
    shortDescription: 'Un builder IA pour transformer une idée en application web fonctionnelle.',
  },
  en: {
    heroTitle: 'From idea to web app.',
    heroSubtitle: 'Describe your project. Coden builds it, verifies it, and helps you publish it.',
    promptPlaceholder: 'Describe the app you want to create…',
    primaryCta: 'Create my app',
    secondaryCta: 'See how it works',
    workflowTitle: 'From idea to live application.',
    workflowDescription: 'Coden helps you move from your first description to a verified preview and controlled publication.',
    previewLabel: 'Preview the application',
    refineLabel: 'Refine it with the agent',
    publishLabel: 'Publish when verified',
    seoTitle: 'Coden — Turn an idea into a web app with AI',
    seoDescription: 'Describe your idea, create a working web app with AI, preview it, improve it, and publish it after verification.',
    shortDescription: 'An AI builder for turning an idea into a working web application.',
  },
};

export function getProductPositioning(locale: ProductLocale): ProductPositioning {
  return POSITIONING[locale] || POSITIONING.en;
}

export function isProductLocale(value: unknown): value is ProductLocale {
  return value === 'fr' || value === 'en';
}
