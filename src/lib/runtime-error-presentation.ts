export type RuntimeErrorLocale = 'fr' | 'en';

export type RuntimeRecoveryPresentation = {
  title: string;
  body: string;
  canRetry: boolean;
  shouldOfferAuto: boolean;
};

/**
 * Diagnostics are an internal contract between the API, observability, and
 * the client. The interface never displays them verbatim; it maps them to a
 * calm recovery state instead. Keeping the normalizer here also prevents a
 * provider message from becoming UI copy by accident.
 */
export function normalizeRuntimeDiagnosticCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 120);
}

export function isRuntimeRecoveryDiagnostic(value: unknown): boolean {
  const code = normalizeRuntimeDiagnosticCode(value);
  return /^(?:PROVIDER_(?:QUOTA_OR_BILLING|RATE_LIMITED|TIMEOUT|UNAVAILABLE|CIRCUIT_OPEN|REQUEST_FAILED|UNSUPPORTED_RUNTIME_CONFIG|BAD_REQUEST)|MODEL_(?:UNAVAILABLE|CATALOG_UNAVAILABLE|CAPABILITY_UNAVAILABLE|MODALITY_UNAVAILABLE|DEFERRED_UNAVAILABLE|OUTPUT_LIMIT)|AGENT_DECISION_UNAVAILABLE)$/.test(code);
}

export function getRuntimeRecoveryPresentation(
  value: unknown,
  locale: RuntimeErrorLocale = 'fr',
): RuntimeRecoveryPresentation | null {
  const code = normalizeRuntimeDiagnosticCode(value);
  if (!isRuntimeRecoveryDiagnostic(code)) return null;
  const fr = locale === 'fr';

  if (/QUOTA|BILLING/.test(code)) {
    return fr
      ? {
          title: 'Le modèle est momentanément indisponible',
          body: 'Votre demande est conservée. Relancez-la plus tard ou choisissez Auto pour essayer un modèle compatible.',
          canRetry: true,
          shouldOfferAuto: true,
        }
      : {
          title: 'This model is temporarily unavailable',
          body: 'Your request is kept. Retry shortly, or choose Auto to try a compatible model.',
          canRetry: true,
          shouldOfferAuto: true,
        };
  }

  if (/RATE_LIMITED|CIRCUIT_OPEN/.test(code)) {
    return fr
      ? {
          title: 'Le service IA est occupé',
          body: 'Votre demande peut être relancée. Les résultats déjà enregistrés sont conservés.',
          canRetry: true,
          shouldOfferAuto: true,
        }
      : {
          title: 'The AI service is busy',
          body: 'Your request can be retried. Previously saved results are kept.',
          canRetry: true,
          shouldOfferAuto: true,
        };
  }

  if (/TIMEOUT/.test(code)) {
    return fr
      ? {
          title: 'Le modèle prend plus de temps que prévu',
          body: 'Votre demande est conservée. Vous pouvez la relancer sans perdre votre travail.',
          canRetry: true,
          shouldOfferAuto: true,
        }
      : {
          title: 'The model is taking longer than expected',
          body: 'Your request is kept. You can retry without losing your work.',
          canRetry: true,
          shouldOfferAuto: true,
        };
  }

  if (/CAPABILITY|MODALITY|DEFERRED|UNSUPPORTED_RUNTIME_CONFIG/.test(code)) {
    return fr
      ? {
          title: 'Ce modèle ne convient pas à cette demande',
          body: 'Choisissez Auto pour laisser Coden sélectionner un modèle qui possède les capacités nécessaires.',
          canRetry: false,
          shouldOfferAuto: true,
        }
      : {
          title: 'This model does not fit this request',
          body: 'Choose Auto so Coden can select a model with the required capabilities.',
          canRetry: false,
          shouldOfferAuto: true,
        };
  }

  if (/OUTPUT_LIMIT/.test(code)) {
    return fr
      ? {
          title: 'La réponse du modèle est incomplète',
          body: 'Ce qui a déjà été produit est conservé. Relancez la demande pour continuer.',
          canRetry: true,
          shouldOfferAuto: true,
        }
      : {
          title: 'The model response is incomplete',
          body: 'Anything already produced is kept. Retry the request to continue.',
          canRetry: true,
          shouldOfferAuto: true,
        };
  }

  return fr
    ? {
        title: 'Le modèle est indisponible pour le moment',
        body: 'Votre demande est conservée. Vous pouvez la relancer ou choisir Auto.',
        canRetry: true,
        shouldOfferAuto: true,
      }
    : {
        title: 'The model is unavailable right now',
        body: 'Your request is kept. You can retry or choose Auto.',
        canRetry: true,
        shouldOfferAuto: true,
      };
}

export function publicRuntimeErrorMessage(value: unknown, locale: RuntimeErrorLocale = 'fr'): string {
  const presentation = getRuntimeRecoveryPresentation(value, locale);
  if (presentation) return `${presentation.title}. ${presentation.body}`;
  const fr = locale === 'fr';
  const code = normalizeRuntimeDiagnosticCode(value);

  if (/^CREDITS_REQUIRED$/.test(code)) {
    return fr
      ? 'Votre solde de crédits est insuffisant pour cette action. Ajoutez des crédits puis relancez la demande.'
      : 'Your credit balance is insufficient for this action. Add credits, then retry the request.';
  }
  if (/TRUNCATED|OUTPUT_LIMIT/.test(code)) {
    return fr
      ? 'La réponse a été coupée avant la fin. Ce qui a déjà été produit est conservé : relancez pour continuer.'
      : 'The response ended before it was complete. Anything already produced is kept: retry to continue.';
  }
  if (/STREAM_INTERRUPTED|STREAM_TRUNCATED|CANCELLED|INTERRUPTED/.test(code)) {
    return fr
      ? 'La connexion s’est interrompue pendant la réponse. Rien n’est perdu : relancez la demande.'
      : 'The connection dropped while responding. Nothing is lost: retry the request.';
  }
  if (/CATALOG/.test(code)) {
    return fr
      ? 'Les modèles disponibles ne peuvent pas être vérifiés pour le moment. Réessayez dans un instant.'
      : 'Available models cannot be verified right now. Try again in a moment.';
  }
  if (/BUDGET|TOOL/.test(code)) {
    return fr
      ? 'Cette étape a atteint sa limite d’exécution. Ce qui a été produit est conservé : relancez pour continuer.'
      : 'This step reached its execution limit. Anything produced is kept: retry to continue.';
  }
  return fr
    ? 'La demande ne peut pas être terminée pour le moment. Votre travail est conservé et vous pouvez la relancer.'
    : 'The request cannot be completed right now. Your work is kept and you can retry it.';
}
