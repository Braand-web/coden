import { createRoot, type Root } from 'react-dom/client';
import { PromptInput, type PromptInputProps } from './components/ui/ai-chat-input';
import './styles/coden-composer.css';

/*
 * One composer, three surfaces, two of which are not React.
 *
 * The dashboard renders `PromptInput` directly. The landing and the Builder
 * are hand-written DOM, and porting the component to vanilla for them would
 * mean maintaining the spring physics, the FLIP gallery and the audio
 * visualiser twice — which is how two composers drift into being different
 * products. The Builder already mounts its conversation as a React island, so
 * the technique is established here rather than novel.
 *
 * The host element is emptied first. Whatever markup it held was the old
 * composer, and leaving it underneath would leave a second textarea that
 * still answers to `querySelectorAll('textarea')`.
 */
const roots = new WeakMap<Element, Root>();

export function mountPromptInput(host: Element, props: PromptInputProps): () => void {
  const existing = roots.get(host);
  if (existing) existing.unmount();

  host.innerHTML = '';
  /*
   * The marker the neutralising rules in coden-composer.css hang off.
   *
   * Added rather than substituted: the Builder finds this very element with
   * `document.querySelector('.chat-input-row')` in three places, so replacing
   * its class list would break the composer's own mount point.
   */
  host.classList.add('coden-composer-host');
  const root = createRoot(host as HTMLElement);
  roots.set(host, root);
  root.render(<PromptInput {...props} />);

  return () => {
    root.unmount();
    roots.delete(host);
  };
}
