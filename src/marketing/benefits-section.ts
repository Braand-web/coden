export const CODEN_BENEFITS = [
  {step:'01',category:'Construire',title:'Passez de l’idée au premier rendu',quote:'Décrivez votre idée. Coden crée une première version que vous pouvez déjà explorer.'},
  {step:'02',category:'Affiner',title:'Faites évoluer votre produit',quote:'Demandez un ajustement, observez le résultat et faites avancer votre application dans le même espace.'},
  {step:'03',category:'Publier',title:'Gardez la main sur la mise en ligne',quote:'Préparez votre publication, vérifiez votre application et partagez-la lorsque vous êtes prêt.'},
];
export function nextTestimonial(index:number,total=CODEN_BENEFITS.length) { return (index+1)%total; }
export function mountTestimonials(doc:Document=document) {
  const section=doc.createElement('section'); section.id='temoignages'; section.className='lp-section lp-testimonials';
  section.setAttribute('aria-label','Les avantages de Coden');
  section.innerHTML='<div class="lp-mesh" data-lp-mesh="soft" aria-hidden="true"></div><div class="lp-testimonial-stage" role="region" aria-label="Ce que vous pouvez faire avec Coden"><span class="lp-quote-mark" aria-hidden="true"></span><div class="lp-testimonial-quotes"></div><div class="lp-testimonial-authors" role="group" aria-label="Explorer les avantages de Coden"></div><div class="lp-testimonial-progress" aria-hidden="true"><span></span></div></div><p class="lp-testimonial-tagline">De la première idée à une application prête à évoluer, avancez à votre rythme avec Coden.</p>';
  const quotes=section.querySelector('.lp-testimonial-quotes')!;
  const authors=section.querySelector('.lp-testimonial-authors')!;
  const view=doc.defaultView!;
  const motion=view.matchMedia('(prefers-reduced-motion: reduce)');
  let current=0, hover=false, focused=false, visible=false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const cards:HTMLElement[]=[]; const buttons:HTMLButtonElement[]=[];
  for(const [index,item] of CODEN_BENEFITS.entries()) {
    const quote=doc.createElement('figure'); quote.className='lp-testimonial-quote'; quote.hidden=index!==0;
    const text=doc.createElement('blockquote'); text.textContent=item.quote;
    const caption=doc.createElement('figcaption'); caption.textContent=item.title;
    quote.append(text,caption); quotes.append(quote); cards.push(quote);
    const button=doc.createElement('button'); button.type='button'; button.className='lp-testimonial-author';
    button.setAttribute('aria-label','Afficher : '+item.title);
    button.setAttribute('aria-pressed',String(index===0));
    const avatar=doc.createElement('span'); avatar.className='lp-avatar'; avatar.textContent=item.step; avatar.setAttribute('aria-hidden','true');
    const copy=doc.createElement('span'); const name=doc.createElement('strong'); name.textContent=item.title;
    const role=doc.createElement('small'); role.textContent=item.category; copy.append(name,role); button.append(avatar,copy);
    button.addEventListener('click',()=> { select(index); update(); }); authors.append(button); buttons.push(button);
  }
  const select=(index:number)=> {
    current=index; cards.forEach((card,i)=>card.hidden=i!==index);
    buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  };
  const update=()=> {
    if(timer) clearTimeout(timer); timer=undefined;
    const stopped=hover||focused||!visible||doc.hidden||motion.matches;
    section.dataset.rotationPaused=String(stopped);
    if(!stopped) timer=setTimeout(()=> {select(nextTestimonial(current)); update();},10000);
  };
  section.addEventListener('mouseenter',()=>{hover=true;update();});
  section.addEventListener('mouseleave',()=>{hover=false;update();});
  section.addEventListener('focusin',()=>{focused=true;update();});
  section.addEventListener('focusout',event=> {if(!section.contains(event.relatedTarget as Node|null)){focused=false;update();}});
  doc.addEventListener('visibilitychange',update);
  motion.addEventListener('change',update);
  const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);update();},{threshold:.2});
  observer.observe(section); update();
  const placeholder = doc.getElementById('temoignages');
  if (placeholder) placeholder.replaceWith(section);
  else doc.querySelector('#tarifs')?.before(section);
  return {section,select,destroy(){if(timer)clearTimeout(timer);observer.disconnect();doc.removeEventListener('visibilitychange',update);motion.removeEventListener('change',update);}};
}
