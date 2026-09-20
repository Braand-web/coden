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
  /*
   * A second call re-renders; it does not remount.
   *
   * Unmounting and recreating the root threw away every piece of component
   * state, and the Builder calls this on each keystroke to push the repaired
   * value back down — so the chosen model, the effort level and any attached
   * screenshots were reset between one character and the next. React already
   * reconciles a re-render into the same tree; the unmount was doing nothing
   * but destroying the session's choices.
   */
  const existing = roots.get(host);
  if (existing) {
    existing.render(<PromptInput {...props} />);
    return () => {
      existing.unmount();
      roots.delete(host);
    };
  }

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
