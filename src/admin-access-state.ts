export type AdminLoadResult = {
  [key: string]: unknown;
  success?: boolean;
  http_status?: unknown;
  diagnostic_code?: unknown;
  error?: unknown;
};

export type AdminLoadFailure = 'forbidden' | 'unavailable';

export function classifyAdminLoadFailure(result: AdminLoadResult): AdminLoadFailure | null {
  if (result.success !== false) return null;
  if (Number(result.http_status) === 403 && result.diagnostic_code === 'ADMIN_ACCESS_REQUIRED') return 'forbidden';
  return 'unavailable';
}

export function adminLoadFailureCopy(failure: AdminLoadFailure, detail?: unknown) {
  if (failure === 'forbidden') {
    return {
      title: 'Accès administrateur requis',
      message: 'Cette session ne dispose pas du rôle administrateur de la plateforme. Aucune donnée du SaaS n’est affichée. Connecte-toi avec le compte autorisé, puis actualise.',
    };
  }

  const safeDetail = typeof detail === 'string' && detail.trim() ? detail.trim() : 'Le service admin n’a pas répondu correctement.';
  return {
    title: 'Données admin indisponibles',
    message: `${safeDetail} Les compteurs ne sont pas remplacés par des zéros fictifs. Réessaie dans un instant.`,
  };
}
