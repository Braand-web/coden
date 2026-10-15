import type { PublicationStatusV2 } from '../../shared/publish.ts';

type Environment = Record<string, string | undefined>;
/** Safe diagnostics: values, tokens and provider responses never enter the UI. */
export function publicationConfigurationChecks(env: Environment, options: { platformOrigin: string; rootDomain: string; requiresBuild?: boolean }): PublicationStatusV2['checks'] {
  const check = (id: string, label: string, valid: boolean, detail: string) => ({ id, label, status: valid ? 'pass' as const : 'fail' as const, ...(valid ? {} : { detail }) });
  let originValid = false;
  try { const url = new URL(options.platformOrigin); originValid = url.protocol === 'https:' && url.origin === options.platformOrigin && !url.username && !url.password && !url.hostname.endsWith('.localhost') && url.hostname !== 'localhost'; } catch { /* invalid configuration */ }
  const checks = [
    check('workers_account', 'Compte Cloudflare', /^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || ''), 'Configurez CLOUDFLARE_ACCOUNT_ID sur le serveur.'),
    check('workers_token', 'Accès Cloudflare', /^[\x21-\x7e]{1,4096}$/.test(env.CLOUDFLARE_API_TOKEN || ''), 'Configurez CLOUDFLARE_API_TOKEN avec les droits Workers et domaines nécessaires.'),
    check('workers_subdomain', 'Adresse fournisseur', /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(env.CLOUDFLARE_WORKERS_SUBDOMAIN || ''), 'Configurez CLOUDFLARE_WORKERS_SUBDOMAIN sur le serveur.'),
    check('workers_secret', 'Passerelle sécurisée', /^[\x21-\x7e]{32,4096}$/.test(env.CODEN_PUBLICATION_PLATFORM_SECRET || ''), 'Configurez un secret de passerelle aléatoire d’au moins 32 caractères.'),
    check('publication_origin', 'Connexion Coden HTTPS', originValid, 'Configurez une origine Coden publique HTTPS, sans chemin ni identifiants.'),
    check('publication_domain', 'Domaine de publication', /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(options.rootDomain), 'Configurez CODEN_ROOT_DOMAIN avec un nom de domaine valide.'),
  ];
  if (options.requiresBuild) checks.push(check('publication_builder', 'Construction isolée', !!env.E2B_API_KEY?.trim() && env.CODEN_SANDBOX_PROVIDER !== 'local', 'Configurez E2B_API_KEY pour construire cette application en microVM isolée. Aucun script du projet ne sera exécuté sur le serveur Coden.'));
  return checks;
}
