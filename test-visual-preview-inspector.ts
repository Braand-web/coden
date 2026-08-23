import assert from 'node:assert/strict';
import { inspectVisualPreview } from './src/services/visual-preview-inspector.ts';

const goodTodoSource = `
import { useMemo, useState } from "react";
export default function App() {
  const [items, setItems] = useState([{ id: 1, title: "Ship MVP", status: "active" }]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const filtered = useMemo(() => items.filter(item => item.title.includes(query) && (status === "all" || item.status === status)), [items, query, status]);
  return <main>
    <h1>Task board</h1>
    <label>Search <input aria-label="Search tasks" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <button onClick={() => setStatus("active")} aria-pressed={status === "active"}>Active</button>
    <button onClick={() => setItems([...items, { id: Date.now(), title: "New task", status: "active" }])}>Add task</button>
    {filtered.length ? filtered.map(item => <article key={item.id}><span>{item.title}</span><button onClick={() => setConfirmingDelete(item.id)}>Delete</button></article>) : <p>empty no results</p>}
    {confirmingDelete ? <div role="dialog" aria-modal="true"><p>Confirm delete?</p><button onClick={() => setItems(items.filter(item => item.id !== confirmingDelete))}>Confirm</button><button onClick={() => setConfirmingDelete(null)}>Cancel</button></div> : null}
    <p>success saved</p><p>error invalid required</p>
  </main>
}`;

const goodChecks = inspectVisualPreview({
  platformType: 'generic_web_app',
  previewHtml: '<!doctype html><html><body><main><h1>Task board</h1><button>Add task</button><input aria-label="Search tasks"><p>empty no results error invalid success saved</p></main></body></html>',
  files: [
    { path: 'src/App.tsx', language: 'tsx', content: goodTodoSource },
    { path: 'src/index.css', language: 'css', content: '@media(max-width: 720px){main{display:block}}' },
  ],
});

assert.equal(goodChecks.find(check => check.key === 'visual_preview_has_content')?.status, 'pass');
assert.equal(goodChecks.find(check => check.key === 'visual_primary_controls')?.status, 'pass');
assert.equal(goodChecks.find(check => check.key === 'visual_controls_have_behavior')?.status, 'pass');
assert.equal(goodChecks.find(check => check.key === 'visual_destructive_confirmation')?.status, 'pass');
assert.equal(goodChecks.find(check => check.key === 'visual_list_tools')?.status, 'pass');
assert.equal(goodChecks.find(check => check.key === 'visual_no_dead_primary_controls')?.status, 'pass');
assert.equal(goodChecks.find(check => check.key === 'visual_state_changes_after_actions')?.status, 'pass');
assert.equal(goodChecks.find(check => check.key === 'visual_no_dead_destinations')?.status, 'pass');

const weakChecks = inspectVisualPreview({
  platformType: 'generic_web_app',
  previewHtml: '<!doctype html><html><body><main><h1>Todo</h1><button>Delete</button></main></body></html>',
  files: [
    { path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){ return <main><h1>Todo</h1><button>Delete</button></main> }' },
  ],
});

assert.equal(weakChecks.find(check => check.key === 'visual_controls_have_behavior')?.status, 'fail');
assert.equal(weakChecks.find(check => check.key === 'visual_destructive_confirmation')?.status, 'fail');
assert.equal(weakChecks.find(check => check.key === 'visual_no_dead_primary_controls')?.status, 'fail');
assert.equal(weakChecks.find(check => check.key === 'visual_state_changes_after_actions')?.status, 'fail');
assert.ok(weakChecks.some(check => check.status === 'fail'));

const deadDestinationChecks = inspectVisualPreview({
  platformType: 'marketplace',
  previewHtml: '<!doctype html><html><body><main><h1>Marketplace</h1><a href="#">Open listing</a><button onClick={() => {}}>Save</button></main></body></html>',
  files: [
    { path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){ return <main><a href="#">Open listing</a><button onClick={() => {}}>Save</button></main> }' },
  ],
});

assert.equal(deadDestinationChecks.find(check => check.key === 'visual_no_dead_destinations')?.status, 'fail');

const weakAuthChecks = inspectVisualPreview({
  platformType: 'auth_flow',
  previewHtml: '<!doctype html><html><body><main><h1>Login</h1><input aria-label="Email"><input aria-label="Password"><button>Sign in</button></main></body></html>',
  files: [
    { path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){ return <main><h1>Login</h1><input aria-label="Email" /><input aria-label="Password" /><button>Sign in</button></main> }' },
  ],
});

assert.equal(weakAuthChecks.find(check => check.key === 'visual_form_submit_feedback')?.status, 'fail');

const switchableUiChecks = inspectVisualPreview({
  platformType: 'saas_dashboard',
  previewHtml: '<!doctype html><html><body><main><h1>Dashboard</h1><button>Overview</button><button>Settings</button><div role="dialog">Details</div></main></body></html>',
  files: [
    {
      path: 'src/App.tsx',
      language: 'tsx',
      content: `
        import { useState } from 'react';
        export default function App(){
          const [activeTab, setActiveTab] = useState('overview');
          const [isOpen, setOpen] = useState(false);
          return <main>
            <button role="tab" aria-selected={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Overview</button>
            <button role="tab" aria-selected={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>Settings</button>
            <button onClick={() => setOpen(true)}>Open details</button>
            {isOpen ? <div role="dialog" aria-modal="true"><button onClick={() => setOpen(false)}>Close</button></div> : null}
            <p>empty error success</p>
          </main>
        }
      `,
    },
    { path: 'src/index.css', language: 'css', content: '@media(max-width: 720px){main{display:block}}' },
  ],
});

assert.equal(switchableUiChecks.find(check => check.key === 'visual_tabs_are_switchable')?.status, 'pass');
assert.equal(switchableUiChecks.find(check => check.key === 'visual_modal_can_open_and_close')?.status, 'pass');

console.log('test-visual-preview-inspector passed');
