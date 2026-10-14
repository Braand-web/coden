import { OFFICIAL_TEMPLATES } from '../services/community/templates';

const visibleSlugs = ['chez-marcel', 'budget-clair', 'cap-sur-le-monde'];
export const SHOWCASE_PROJECTS = visibleSlugs.map(slug => {
  const template = OFFICIAL_TEMPLATES.find(item => item.slug === slug)!;
  return {slug, title:template.title, description:template.description,
    category: slug === 'chez-marcel' ? 'Restaurant' : slug === 'budget-clair' ? 'Gestion' : 'Jeu',
    thumbnail:'/community-templates/'+slug+'.webp', preview:'/projects/'+slug+'.html'};
});
export function mountCommunitySection(doc:Document = document) {
  const section = doc.createElement('section');
  section.id = 'communaute'; section.className = 'lp-section lp-community'; section.setAttribute('aria-label','Projets de démonstration');
  section.innerHTML = '<div class="lp-community-grid"></div>';
  const grid = section.querySelector('.lp-community-grid')!;
  const modal = doc.createElement('dialog');
  modal.className = 'lp-project-dialog'; modal.setAttribute('aria-labelledby','project-preview-title');
  modal.innerHTML = '<div class="lp-project-topbar"><div><h2 id="project-preview-title"></h2><p data-preview-description></p></div><button type="button" class="lp-icon-button" data-preview-close aria-label="Fermer l’aperçu">×</button></div><div class="lp-project-controls" role="group" aria-label="Taille de l’aperçu"><button type="button" data-preview-size="desktop" aria-pressed="true">Bureau</button><button type="button" data-preview-size="mobile" aria-pressed="false">Mobile</button><span>Projet de démonstration</span></div><div class="lp-project-stage"><div class="lp-project-loading" role="status">Chargement de l’aperçu…</div></div>';
  doc.body.append(modal);
  const stage = modal.querySelector<HTMLElement>('.lp-project-stage')!;
  let trigger:HTMLButtonElement|null = null;
  let frame:HTMLIFrameElement|null = null;
  const close = () => modal.close();
  modal.querySelector('[data-preview-close]')!.addEventListener('click', close);
  modal.addEventListener('click', event=> { if (event.target===modal) close(); });
  modal.addEventListener('close',()=> {
    frame?.remove(); frame=null; stage.classList.remove('is-mobile');
    trigger?.focus({preventScroll:true});
  });
  for(const size of modal.querySelectorAll<HTMLButtonElement>('[data-preview-size]')) {
    size.addEventListener('click',()=> {
      stage.classList.toggle('is-mobile',size.dataset.previewSize==='mobile');
      modal.querySelectorAll<HTMLButtonElement>('[data-preview-size]').forEach(button=>button.setAttribute('aria-pressed',String(button===size)));
    });
  }
  for (const project of SHOWCASE_PROJECTS) {
    const article = doc.createElement('article'); article.className = 'lp-community-card';
    const button = doc.createElement('button'); button.type='button'; button.className='lp-community-open';
    button.setAttribute('aria-label','Prévisualiser '+project.title);
    const image = doc.createElement('img'); image.src=project.thumbnail; image.alt='Aperçu du projet '+project.title;
    image.width=800; image.height=500; image.loading='lazy'; image.decoding='async';
    const thumb=doc.createElement('span'); thumb.className='lp-community-thumb'; thumb.append(image);
    const overlay=doc.createElement('span'); overlay.className='lp-community-hover'; overlay.textContent='Prévisualiser'; thumb.append(overlay);
    const meta=doc.createElement('span'); meta.className='lp-community-meta';
    const copy=doc.createElement('span'); const title=doc.createElement('strong'); title.textContent=project.title;
    const category=doc.createElement('small'); category.textContent=project.category+' · Template Coden';
    copy.append(title,category);
    const arrow=doc.createElement('span'); arrow.className='lp-community-arrow'; arrow.textContent='↗'; arrow.setAttribute('aria-hidden','true');
    meta.append(copy,arrow); button.append(thumb,meta); article.append(button); grid.append(article);
    button.addEventListener('click',()=> {
      trigger=button; frame?.remove();
      modal.querySelector('#project-preview-title')!.textContent=project.title;
      modal.querySelector('[data-preview-description]')!.textContent=project.description;
      const loading=stage.querySelector<HTMLElement>('.lp-project-loading')!; loading.hidden=false; loading.textContent='Chargement de l’aperçu…';
      stage.classList.remove('is-mobile');
      modal.querySelectorAll<HTMLButtonElement>('[data-preview-size]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.previewSize==='desktop')));
      frame=doc.createElement('iframe'); frame.title='Aperçu interactif de '+project.title;
      frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-downloads');
      frame.setAttribute('referrerpolicy','no-referrer');
      frame.src=project.preview;
      const activeFrame=frame;
      frame.addEventListener('load',()=> { if(frame===activeFrame) loading.hidden=true; });
      frame.addEventListener('error',()=> { if(frame===activeFrame) loading.textContent='L’aperçu est indisponible. Fermez et réessayez.'; });
      stage.append(frame); modal.showModal();
    });
  }
  const placeholder = doc.getElementById('communaute');
  if (placeholder) placeholder.replaceWith(section);
  else doc.querySelector('#tarifs')?.before(section);
  return {section,modal};
}
