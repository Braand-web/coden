import { describe, expect, it } from 'vitest';
import { inspectVisualPreview } from './visual-preview-inspector';

const inspect = (content: string, platformType: any = 'generic_web_app') =>
  inspectVisualPreview({ files: [{ path: 'src/App.tsx', content }], platformType } as any);
const dead = (checks: ReturnType<typeof inspect>) => checks.find(check => check.key === 'visual_no_dead_primary_controls');

describe('dead controls are read from whole tags', () => {
  it('a button whose handler is an arrow function is not a dead control', () => {
    const checks = inspect(`export default function App(){ return <main>
      <button onClick={() => go('create')}>Créer une demande</button>
      <button onClick={()=>document.querySelector('.x')?.click()} className="a">Ouvrir</button>
      <button className="b" onClick={() => setOpen(true)}>Ajouter un livreur</button>
      <button onClick={onAdd}>Ajouter un membre</button>
    </main>; }`);
    expect(dead(checks)?.status).toBe('pass');
  });

  it('a button with no handler at all is still reported, under its own label', () => {
    const checks = inspect(`export default function App(){ return <main><button className="cta">Réserver</button><button onClick={() => x()}>Ok</button></main>; }`);
    const found = dead(checks);
    expect(found?.status).not.toBe('pass');
    expect(found?.message).toMatch(/Réserver/);
    expect(found?.message).not.toMatch(/onClick|\}/);
  });

  it('reads links with a computed href, a template literal containing a brace, and a self-closing input', () => {
    const checks = inspect(`export default function App(){ return <main>
      <a href={\`tel:\${phone}\`}>Appeler</a>
      <a href={mapsUrl}>Itinéraire</a>
      <input value={q} onChange={e => setQ(e.target.value)} />
      <button onClick={() => { const a = {x: 1}; run(a); }}>Lancer</button>
    </main>; }`);
    expect(dead(checks)?.status).toBe('pass');
  });
});
