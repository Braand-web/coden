import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './template-base.css';

const loaders = {
  'chez-marcel': () => import('../templates/community/chez-marcel/src/App'),
  'budget-clair': () => import('../templates/community/budget-clair/src/App'),
  'cap-sur-le-monde': () => import('../templates/community/cap-sur-le-monde/src/App'),
};
class PreviewBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    return this.state.failed ? <main className="grid min-h-screen place-content-center gap-4 p-8 text-center"><h1 className="text-2xl">L’aperçu n’a pas pu démarrer.</h1><button className="rounded-control bg-accent p-3 text-on-accent" onClick={()=>location.reload()}>Réessayer</button></main> : this.props.children;
  }
}
const slug = document.body.dataset.template as keyof typeof loaders;
const root = document.getElementById('root');
async function mountExample() {
  if (!root || !loaders[slug]) return;
  try {
    const {default:App} = await loaders[slug]();
    createRoot(root).render(<PreviewBoundary><App /></PreviewBoundary>);
  } catch {
    root.textContent = 'Aperçu momentanément indisponible. Actualisez pour réessayer.';
  }
}
void mountExample();
