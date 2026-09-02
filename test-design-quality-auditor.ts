import assert from 'node:assert/strict';
import {
  auditGeneratedDesign,
  auditGeneratedFunctionality,
} from './src/services/design-quality-auditor.ts';

const goodFiles = [
  {
    path: 'package.json',
    language: 'json',
    content: JSON.stringify({
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest run',
        lint: 'tsc --noEmit',
      },
      dependencies: {
        '@vitejs/plugin-react': 'latest',
        vite: 'latest',
        react: 'latest',
        'react-dom': 'latest',
      },
    }),
  },
  {
    path: 'index.html',
    language: 'html',
    content: '<!doctype html><html><head><title>AI Studio</title><meta name="description" content="AI tool"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  },
  {
    path: 'src/main.tsx',
    language: 'tsx',
    content: 'import React from "react"; import { createRoot } from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")!).render(<App />);',
  },
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: `
      import { useState } from "react";
      export default function App() {
        const [prompt, setPrompt] = useState("");
        const [status, setStatus] = useState("empty");
        const [messages, setMessages] = useState(["Prompt history"]);
        function send() {
          if (!prompt.trim()) { setStatus("error"); return; }
          setMessages([...messages, prompt]);
          setStatus("success");
        }
        return <main aria-label="AI tool workspace">
          <h1>AI workflow preview</h1>
          <p>Prompt, message stream, model status, preview output and usage status.</p>
          <form onSubmit={(event) => { event.preventDefault(); send(); }}>
            <label>Prompt <input required value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
            <button type="submit" onClick={send}>Generate preview</button>
          </form>
          <section>{status === "error" ? "Validation error" : status === "success" ? "Output ready" : "Empty conversation"}</section>
          <aside>Model selector and streaming checks</aside>
        </main>;
      }
    `,
  },
  {
    path: 'src/index.css',
    language: 'css',
    content: `
      :root {
        --bg: #fcfbf8;
        --text: #1c1c1c;
        --space-4: 16px;
        --radius: 16px;
        --motion: 160ms;
        --success: #16794f;
        --warning: #a15c00;
        --error: #b42318;
        --info: #2457d6;
      }
      body { background: var(--bg); color: var(--text); }
      button { min-height: 44px; min-width: 44px; transition: transform var(--motion) cubic-bezier(.22,1,.36,1); }
      button:hover { transform: translateY(-1px); }
      button:focus-visible, input:focus-visible { outline: 2px solid #2457d6; }
      .skeleton { animation: pulse 1.2s infinite; }
      @keyframes pulse { from { opacity: .6; } to { opacity: 1; } }
      @media (max-width: 720px) { main { display: grid; grid-template-columns: 1fr; } }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
    `,
  },
];

const weakFiles = [
  {
    path: 'index.html',
    language: 'html',
    content: '<!doctype html><html><head><title>Demo</title></head><body><h1>Welcome to your app</h1><button>Click me</button><section>Feature 1</section><style>.hero{background:linear-gradient(135deg,#667eea,#764ba2)}</style></body></html>',
  },
];

const designChecks = auditGeneratedDesign({
  files: goodFiles,
  previewHtml: goodFiles[1].content,
  platformType: 'ai_tool',
  designDirection: 'dense_devtool',
});
assert.equal(designChecks.find(check => check.key === 'design_score')?.status, 'pass');
assert.equal(designChecks.find(check => check.key === 'design_platform_fit')?.status, 'pass');

const functionalityChecks = auditGeneratedFunctionality({
  files: goodFiles,
  previewHtml: goodFiles[1].content,
  platformType: 'ai_tool',
  hasExistingFiles: false,
});
assert.equal(functionalityChecks.find(check => check.key === 'functionality_modern_project')?.status, 'pass');
assert.equal(functionalityChecks.find(check => check.key === 'functionality_score')?.status, 'pass');

const weakDesign = auditGeneratedDesign({
  files: weakFiles,
  previewHtml: weakFiles[0].content,
  platformType: 'landing_page',
  designDirection: 'cinematic_landing',
});
assert.equal(weakDesign.find(check => check.key === 'design_no_ai_gradient')?.status, 'fail');
assert.notEqual(weakDesign.find(check => check.key === 'design_score')?.status, 'pass');

// Test New UI/UX Pro Max rules
const emojiFiles = [
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: 'export default function App() { return <button>🎨 Design Mode</button>; }'
  },
  {
    path: 'src/index.css',
    language: 'css',
    content: ':root { --bg: #fff; }'
  }
];
const emojiDesignAudit = auditGeneratedDesign({
  files: emojiFiles,
  platformType: 'generic_web_app'
});
assert.equal(emojiDesignAudit.find(check => check.key === 'design_no_emoji_icons')?.status, 'fail');

const noCursorPointerFiles = [
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: 'export default function App() { return <div onClick={() => {}}>Clickable Card</div>; }'
  },
  {
    path: 'src/index.css',
    language: 'css',
    content: 'div { background: #fff; }'
  }
];
const cursorDesignAudit = auditGeneratedDesign({
  files: noCursorPointerFiles,
  platformType: 'generic_web_app'
});
assert.equal(cursorDesignAudit.find(check => check.key === 'design_cursor_pointer')?.status, 'fail');

const weakFunctionality = auditGeneratedFunctionality({
  files: weakFiles,
  previewHtml: weakFiles[0].content,
  platformType: 'landing_page',
  hasExistingFiles: false,
});
assert.equal(weakFunctionality.find(check => check.key === 'functionality_modern_project')?.status, 'fail');
assert.equal(weakFunctionality.find(check => check.key === 'functionality_primary_controls')?.status, 'fail');

const todoBaseFiles = [
  ...goodFiles.filter(file => file.path !== 'src/App.tsx' && file.path !== 'index.html'),
  {
    path: 'index.html',
    language: 'html',
    content: '<!doctype html><html><head><title>Todo App</title><meta name="description" content="Task manager"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  },
];

const weakTodoFiles = [
  ...todoBaseFiles,
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: `
      export default function App() {
        return <main>
          <h1>Todo app</h1>
          <p>Coming soon: add tasks, complete tasks and delete tasks.</p>
          <button>New task</button>
          <section>No tasks yet</section>
        </main>;
      }
    `,
  },
];

const weakTodoFunctionality = auditGeneratedFunctionality({
  files: weakTodoFiles,
  previewHtml: todoBaseFiles.find(file => file.path === 'index.html')?.content,
  platformType: 'generic_web_app',
  hasExistingFiles: false,
  prompt: 'cree une todo app avec ajout suppression filtres et localStorage',
});
assert.equal(weakTodoFunctionality.find(check => check.key === 'functionality_no_unimplemented_copy')?.status, 'fail');
assert.equal(weakTodoFunctionality.find(check => check.key === 'functionality_todo_core_loop')?.status, 'fail');

const strongTodoFiles = [
  ...todoBaseFiles,
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: `
      import { useMemo, useState } from "react";
      type Task = { id: number; title: string; completed: boolean };
      export default function App() {
        const [tasks, setTasks] = useState<Task[]>([
          { id: 1, title: "Sketch onboarding", completed: false },
          { id: 2, title: "Review mobile layout", completed: true }
        ]);
        const [title, setTitle] = useState("");
        const [search, setSearch] = useState("");
        const [filter, setFilter] = useState("all");
        const [status, setStatus] = useState("empty");
        const visibleTasks = useMemo(() => tasks.filter(task => {
          const matchesSearch = task.title.toLowerCase().includes(search.toLowerCase());
          const matchesFilter = filter === "all" || (filter === "completed" ? task.completed : !task.completed);
          return matchesSearch && matchesFilter;
        }), [tasks, search, filter]);
        function addTask(event: React.FormEvent) {
          event.preventDefault();
          if (!title.trim()) { setStatus("error"); return; }
          setTasks([...tasks, { id: Date.now(), title, completed: false }]);
          setTitle("");
          setStatus("success");
        }
        function toggleTask(id: number) {
          setTasks(tasks.map(task => task.id === id ? { ...task, completed: !task.completed } : task));
          setStatus("saved");
        }
        function deleteTask(id: number) {
          if (!confirm("Delete this task? Undo is not available in this demo.")) return;
          setTasks(tasks.filter(task => task.id !== id));
          setStatus("success");
        }
        return <main aria-label="Todo workspace">
          <h1>Todo app</h1>
          <form onSubmit={addTask}>
            <label>Task title <input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <button type="submit">Add task</button>
          </form>
          <label>Search <input aria-label="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <button type="button" onClick={() => setFilter("all")}>All</button>
          <button type="button" onClick={() => setFilter("active")}>Active</button>
          <button type="button" onClick={() => setFilter("completed")}>Completed</button>
          <p role="status">{status === "error" ? "Validation error" : status === "success" ? "Task saved successfully" : "Empty state ready"}</p>
          <ul>{visibleTasks.map(task => <li key={task.id}>
            <label><input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)} /> {task.title}</label>
            <button type="button" onClick={() => deleteTask(task.id)}>Delete</button>
          </li>)}</ul>
        </main>;
      }
    `,
  },
];

const strongTodoFunctionality = auditGeneratedFunctionality({
  files: strongTodoFiles,
  previewHtml: todoBaseFiles.find(file => file.path === 'index.html')?.content,
  platformType: 'generic_web_app',
  hasExistingFiles: false,
  prompt: 'cree une todo app avec ajout suppression filtres et localStorage',
});
assert.equal(strongTodoFunctionality.find(check => check.key === 'functionality_todo_core_loop')?.status, 'pass');
assert.equal(strongTodoFunctionality.find(check => check.key === 'functionality_todo_management_tools')?.status, 'pass');
assert.equal(strongTodoFunctionality.find(check => check.key === 'functionality_score')?.status, 'pass');

const pomodoroFiles = [
  ...goodFiles.filter(file => file.path !== 'src/App.tsx' && file.path !== 'index.html'),
  {
    path: 'index.html',
    language: 'html',
    content: '<!doctype html><html><head><title>Pomodoro Focus</title><meta name="description" content="Productivity timer"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  },
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: `
      import { useMemo, useState } from "react";
      export default function App() {
        const [mode, setMode] = useState("work");
        const [seconds, setSeconds] = useState(1500);
        const [running, setRunning] = useState(false);
        const [status, setStatus] = useState("Ready for deep work tasks.");
        const minutes = useMemo(() => Math.floor(seconds / 60), [seconds]);
        function startTimer() { setRunning(true); setStatus("Focus session running."); }
        function pauseTimer() { setRunning(false); setStatus("Timer paused."); }
        function resetTimer() { setSeconds(mode === "work" ? 1500 : 300); setRunning(false); setStatus("Timer reset."); }
        function switchMode(nextMode: string) { setMode(nextMode); setSeconds(nextMode === "work" ? 1500 : 300); setStatus("Mode updated."); }
        return <main aria-label="Pomodoro productivity timer">
          <h1>Pomodoro Focus</h1>
          <p>Plan work sessions, breaks and daily productivity without becoming a task manager or a product checkout.</p>
          <button type="button" onClick={startTimer}>{running ? "Running" : "Start"}</button>
          <button type="button" onClick={pauseTimer}>Pause</button>
          <button type="button" onClick={resetTimer}>Reset</button>
          <button type="button" onClick={() => switchMode("work")}>Work</button>
          <button type="button" onClick={() => switchMode("break")}>Break</button>
          <section aria-live="polite">{minutes} minutes left. {status}</section>
        </main>;
      }
    `,
  },
];

const pomodoroFunctionality = auditGeneratedFunctionality({
  files: pomodoroFiles,
  previewHtml: pomodoroFiles.find(file => file.path === 'index.html')?.content,
  platformType: 'generic_web_app',
  hasExistingFiles: false,
  prompt: 'genere une mini app de pomodero avec start pause reset',
});
assert.equal(pomodoroFunctionality.find(check => check.key === 'functionality_todo_core_loop'), undefined);
assert.equal(pomodoroFunctionality.find(check => check.key === 'functionality_commerce_core_loop'), undefined);

const staleProjectPomodoroFunctionality = auditGeneratedFunctionality({
  files: pomodoroFiles,
  previewHtml: pomodoroFiles.find(file => file.path === 'index.html')?.content,
  platformType: 'generic_web_app',
  hasExistingFiles: true,
  prompt: 'genere une mini app de pomodero avec historique local',
});
assert.equal(staleProjectPomodoroFunctionality.find(check => check.key === 'functionality_todo_core_loop'), undefined);
assert.equal(staleProjectPomodoroFunctionality.find(check => check.key === 'functionality_commerce_core_loop'), undefined);


// A Tailwind project is what the generator actually produces: index.css holds
// only the three @tailwind directives, and every styling decision lives in
// utility classes and the Tailwind theme. Auditing .css files alone therefore
// failed all seven design checks on any correct Tailwind app — and
// design_responsive is `high` severity, so the preview was blocked on a
// structural false negative that no auto-fix could ever repair.
const tailwindCss = {
  path: 'src/index.css',
  language: 'css',
  content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
};

const tailwindConfig = {
  path: 'tailwind.config.ts',
  language: 'ts',
  content: [
    "import type { Config } from 'tailwindcss';",
    'export default {',
    "  content: ['./index.html', './src/**/*.{ts,tsx}'],",
    '  theme: { extend: { colors: {',
    "    success: '#16794f', warning: '#a15c00', error: '#b42318', info: '#2457d6',",
    '  } } },',
    '} satisfies Config;',
  ].join('\n'),
};

const tailwindApp = (className: string) => ({
  path: 'src/App.tsx',
  language: 'tsx',
  content: [
    'import { useState } from "react";',
    'export default function App() {',
    '  const [total, setTotal] = useState(0);',
    '  return (',
    `    <main className="${className}">`,
    '      <h1>Budget</h1>',
    '      <button type="button" aria-label="Add" onClick={() => setTotal(total + 1)}>Add</button>',
    '      <p>{total === 0 ? "No entry yet" : total}</p>',
    '    </main>',
    '  );',
    '}',
  ].join('\n'),
});

const tailwindShell = [
  goodFiles.find(file => file.path === 'package.json')!,
  goodFiles.find(file => file.path === 'index.html')!,
  goodFiles.find(file => file.path === 'src/main.tsx')!,
  tailwindCss,
  tailwindConfig,
];

const responsiveClasses = 'grid grid-cols-1 md:grid-cols-2 gap-4 p-6 md:p-10 text-base '
  + 'transition duration-200 ease-out motion-reduce:transition-none h-12 min-h-12';
const tailwindDesign = auditGeneratedDesign({
  files: [...tailwindShell, tailwindApp(responsiveClasses)],
  previewHtml: goodFiles.find(file => file.path === 'index.html')!.content,
  platformType: 'generic_web_app',
  hasExistingFiles: false,
  prompt: 'budget tracker',
});
for (const key of [
  'design_tokens',
  'design_semantic_tokens',
  'design_spacing_system',
  'design_touch_targets',
  'design_responsive',
  'design_motion',
  'design_reduced_motion',
]) {
  const check = tailwindDesign.find(item => item.key === key);
  assert.equal(check?.status, 'pass', `${key} must pass on a correct Tailwind app, got ${check?.status}`);
}

// The scope fix must not blind the check: an app with no breakpoint variant at
// all is genuinely not responsive, and design_responsive must still block it.
const flatDesign = auditGeneratedDesign({
  files: [...tailwindShell, tailwindApp('flex flex-col gap-4 p-6')],
  previewHtml: goodFiles.find(file => file.path === 'index.html')!.content,
  platformType: 'generic_web_app',
  hasExistingFiles: false,
  prompt: 'budget tracker',
});
const flatResponsive = flatDesign.find(item => item.key === 'design_responsive');
assert.equal(flatResponsive?.status, 'fail', 'a layout with no breakpoint variant is not responsive');
assert.equal(flatResponsive?.severity, 'high');
assert.equal(
  flatDesign.find(item => item.key === 'design_reduced_motion')?.status,
  'fail',
  'a Tailwind app with no motion-reduce variant still misses its reduced-motion fallback',
);

console.log('test-design-quality-auditor passed');
