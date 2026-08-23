function initBuilder() {
  // ── INITIAL THEME ───────────────────────────────────────────
  // Coden Forge is dark by default. Respect an explicit user choice only;
  // the operating-system preference must not silently change the product
  // surface for a first-time visitor.
  const stored = localStorage.getItem('coden-theme');
  const initialTheme = stored === 'light' || stored === 'dark'
    ? stored
    : 'dark';
  document.documentElement.setAttribute('data-theme', initialTheme);

  // Project identity is synchronized by builder-live.ts from the backend.

  // ── CODE CONTENT ────────────────────────────────────────────────
  const codeLines: [string, boolean][] = [];

  const codeArea = document.getElementById('code-area');
  if (codeArea) {
    codeArea.innerHTML = '';
    codeLines.forEach((lineData, i) => {
      const html = lineData[0] as string;
      const isActive = lineData[1] as boolean;
      const line = document.createElement('div');
      line.className = 'code-line' + (isActive ? ' cursor-line' : '');
      line.innerHTML = `<span class="line-num">${i + 1}</span><span class="code-content">${html}${isActive ? '<span class="cursor"></span>' : ''}</span>`;
      codeArea.appendChild(line);
    });
  }

  // ── FILE TREE ───────────────────────────────────────────────────
  const fileTree = document.getElementById('file-tree');
  const previewArea = document.getElementById('file-preview-area');
  const previewEmpty = document.querySelector('.preview-empty');
  const previewContent = document.getElementById('preview-content');
  const previewCode = document.getElementById('preview-code');
  const previewFilename = document.getElementById('preview-filename');

  const extColor: Record<string, string> = { 
    tsx: '#60A5FA', 
    css: '#A78BFA', 
    ts: '#34D399', 
    json: '#FBBF24', 
    js: '#FBBF24', 
    html: '#F87171',
    png: '#EC4899',
    jpg: '#EC4899'
  };

  const fileContents: Record<string, string> = {};
  
  function getColor(name: string) {
    const ext = name.split('.').pop() || '';
    return extColor[ext] || '#606060';
  }

  function getIcon(item: any) {
    if (item.type === 'folder') {
      return `<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    }
    const ext = item.name.split('.').pop() || '';
    if (['tsx', 'ts', 'js'].includes(ext)) {
      return `<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="${getColor(item.name)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
    }
    if (ext === 'css') {
      return `<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="${getColor(item.name)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>`;
    }
    return `<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="${getColor(item.name)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
  }

  function updatePreview(name: string) {
    if (!previewEmpty || !previewContent || !previewCode || !previewFilename) return;
    previewEmpty.classList.add('hidden');
    previewContent.classList.remove('hidden');
    previewFilename.textContent = name;
    previewCode.textContent = fileContents[name] || `// ${name}\n// No generated source has been synchronized for this file yet.`;
  }

  const structure: any[] = [];

  function renderTree(items: any[], container: HTMLElement) {
    items.forEach(item => {
      if (item.type === 'folder') {
        const group = document.createElement('div');
        group.className = 'file-group';
        const header = document.createElement('div');
        header.className = 'folder-header open';
        header.innerHTML = `
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          ${getIcon(item)}
          <span class="folder-name">${item.name}/</span>`;
        const children = document.createElement('div');
        children.className = 'folder-children';
        renderTree(item.children, children);
        header.addEventListener('click', () => {
          const open = header.classList.toggle('open');
          children.style.display = open ? '' : 'none';
        });
        group.appendChild(header);
        group.appendChild(children);
        container.appendChild(group);
      } else {
        const fi = document.createElement('div');
        fi.className = 'file-item' + (item.active ? ' active' : '');
        fi.innerHTML = `
          ${getIcon(item)}
          <span class="file-name">${item.name}</span>
          <span class="file-size">${item.size}</span>`;
        fi.addEventListener('click', () => {
          document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
          fi.classList.add('active');
          updatePreview(item.name);
          addToHistory(`Viewed ${item.name}`);
        });
        container.appendChild(fi);
      }
    });
  }

  if (fileTree) {
    fileTree.innerHTML = '';
    renderTree(structure, fileTree);
  }

  // ── UPLOAD LOGIC ───────────────────────────────────────────────
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const uploadActions = document.getElementById('upload-actions');
  const selectedFilesList = document.getElementById('selected-files-list');
  const btnDoUpload = document.getElementById('btn-do-upload');
  let pendingFiles: File[] = [];

  fileInput?.addEventListener('change', () => {
    if (fileInput.files) {
      pendingFiles = Array.from(fileInput.files);
      if (pendingFiles.length > 0) {
        uploadActions?.classList.remove('hidden');
        if (selectedFilesList) {
          selectedFilesList.innerHTML = '';
          pendingFiles.forEach(file => {
            const item = document.createElement('div');
            item.className = 'sel-file-item';
            item.innerHTML = `<span>${file.name}</span><span>${(file.size / 1024).toFixed(1)}kb</span>`;
            selectedFilesList.appendChild(item);
          });
        }
      }
    }
  });

  btnDoUpload?.addEventListener('click', () => {
    if (pendingFiles.length === 0) return;
    
    showToast(`Uploading ${pendingFiles.length} files...`);
    
    // Add to structure (Mock)
    pendingFiles.forEach(file => {
      structure.push({
        type: 'file',
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)}kb`
      });
    });

    // Re-render tree
    if (fileTree) {
      fileTree.innerHTML = '';
      renderTree(structure, fileTree);
    }

    addToHistory(`Uploaded ${pendingFiles.length} files`);

    // Reset
    pendingFiles = [];
    fileInput.value = '';
    uploadActions?.classList.add('hidden');
    if (selectedFilesList) selectedFilesList.innerHTML = '';
  });

  // ── VIEW TABS ──────────────────────────────────────────────────
  const mainPanel = document.getElementById('main-panel') as HTMLElement;
  const handleR = document.getElementById('handle-right') as HTMLElement;
  const previewPanel = document.getElementById('preview-panel') as HTMLElement;
  const layout = document.querySelector('.app-layout') as HTMLElement;

  let currentView = 'split';
  let isCollapsed = false;

  function updateLayout() {
    const collapseBtn = document.getElementById('btn-collapse-chat');
    if (collapseBtn) {
      if (isCollapsed) collapseBtn.classList.add('collapsed');
      else collapseBtn.classList.remove('collapsed');
    }

    if (currentView === 'preview') {
      mainPanel.style.display = 'none';
      handleR.style.display = 'none';
      previewPanel.style.display = '';
      layout.style.gridTemplateColumns = `0px 0px 1fr`;
      return;
    }

    mainPanel.style.display = '';
    
    if (isCollapsed) {
      layout.classList.add('chat-collapsed');
      const sideW = '40px'; 
      if (currentView === 'code') {
        isCollapsed = false;
        layout.classList.remove('chat-collapsed');
        handleR.style.display = 'none';
        previewPanel.style.display = 'none';
        layout.style.gridTemplateColumns = `1fr 0px 0px`;
      } else {
        handleR.style.display = 'none';
        previewPanel.style.display = '';
        layout.style.gridTemplateColumns = `${sideW} 0px 1fr`;
      }
    } else {
      layout.classList.remove('chat-collapsed');
      if (currentView === 'code') {
        handleR.style.display = 'none';
        previewPanel.style.display = 'none';
        layout.style.gridTemplateColumns = `1fr 0px 0px`;
      } else {
        handleR.style.display = '';
        previewPanel.style.display = '';
        const sideW = layout.style.getPropertyValue('--side-w') || '360px';
        layout.style.gridTemplateColumns = `${sideW} 4px 1fr`;
      }
    }
    window.dispatchEvent(new Event('resize'));
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = (btn as HTMLElement).dataset.view || 'split';
      addToHistory(`Changed view to ${currentView}`);
      updateLayout();
    });
  });

  // ── SUB TABS ──────────────────────────────────────────────────
  const savedSubTab = localStorage.getItem('coden-sub-tab') || 'chat';
  const subTabs = document.querySelectorAll('.sub-tab');
  
  function setSubTab(sub: string) {
    subTabs.forEach(t => t.classList.toggle('active', (t as HTMLElement).dataset.sub === sub));
    const tabChat = document.getElementById('tab-chat');
    const tabCode = document.getElementById('tab-code');
    const tabFiles = document.getElementById('tab-files');
    
    if (tabChat) tabChat.classList.toggle('hidden', sub !== 'chat');
    if (tabCode) tabCode.classList.toggle('hidden', sub !== 'code');
    if (tabFiles) tabFiles.classList.toggle('hidden', sub !== 'files');
    localStorage.setItem('coden-sub-tab', sub);
  }

  subTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const sub = (tab as HTMLElement).dataset.sub || 'chat';
      setSubTab(sub);
      addToHistory(`Switched to ${sub} tab`);
    });
  });

  // Initial tab
  setSubTab(savedSubTab);

  // ── DEVICE SWITCHER ──────────────────────────────────────────
  const savedDevice = localStorage.getItem('coden-preview-device') || 'desktop';
  const previewFrame = document.getElementById('preview-frame');
  const deviceBtns = document.querySelectorAll('.device-btn');

  function setDevice(device: string) {
    deviceBtns.forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.device === device));
    if (previewFrame) {
      previewFrame.className = 'preview-frame';
      if (device !== 'desktop') previewFrame.classList.add(device);
    }
    localStorage.setItem('coden-preview-device', device);
  }

  deviceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const d = (btn as HTMLElement).dataset.device || 'desktop';
      setDevice(d);
      addToHistory(`Toggle device: ${d}`);
    });
  });

  // Initial device
  setDevice(savedDevice);

  // ── CONSOLE TOGGLE ──────────────────────────────────────────
  const consolePanel = document.getElementById('console-panel');
  document.getElementById('console-toggle')?.addEventListener('click', () => {
    consolePanel?.classList.add('open');
  });
  document.getElementById('console-close')?.addEventListener('click', () => {
    consolePanel?.classList.remove('open');
  });

  // ── CONSOLE SUB TABS ────────────────────────────────────────
  document.querySelectorAll('.console-sub-tab:not(#console-close)').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.console-sub-tab:not(#console-close)').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // ── MODE SELECT LOGIC ────────────────────────────────────
  const chatTextarea = document.getElementById('ai-textarea') as HTMLTextAreaElement;
  const btnSend = document.getElementById('btn-send-builder') as HTMLButtonElement;
  const modeSelectWrap = document.getElementById('mode-select-wrap');
  const modeDropdownUI = document.getElementById('mode-dropdown-ui');
  const currentModeLabelUI = document.getElementById('current-mode-label-ui');
  const modeDotIndicator = document.getElementById('mode-dot-indicator');
  const modeOptions = document.querySelectorAll('.mode-opt');
  let currentMode = 'auto';

  modeSelectWrap?.addEventListener('click', (e) => {
    e.stopPropagation();
    modeDropdownUI?.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    modeDropdownUI?.classList.remove('open');
  });

  modeOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const rawMode = (opt as HTMLElement).dataset.mode;
      const mode = rawMode === 'plan' ? 'plan' : rawMode === 'build' ? 'build' : 'auto';
      currentMode = mode;
      
      modeOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      
      if (currentModeLabelUI) currentModeLabelUI.textContent = mode;
      if (modeDotIndicator) {
        modeDotIndicator.className = 'mode-dot ' + mode;
      }
      
      if (currentMode === 'plan') {
        chatTextarea.placeholder = 'Search, brainstorm or explore...';
      } else {
        chatTextarea.placeholder = 'Ask a question or request a change...';
      }
      
      modeDropdownUI?.classList.remove('open');
      addToHistory(`Switched to ${currentMode} mode`);
    });
  });

  const modelSelectBtn = document.getElementById('model-select-btn');
  const modelDropdown = document.getElementById('model-dropdown');
  const modelLabel = document.getElementById('current-model-label');
  const modelOptions = document.querySelectorAll('.model-option');

  // Model Selector Logic
  modelSelectBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!modelDropdown) return;
    const isOpen = modelDropdown.classList.contains('open');
    modelDropdown.classList.toggle('open', !isOpen);
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (modelDropdown && !modelDropdown.contains(target)) {
      modelDropdown.classList.remove('open');
    }
  });

  // Initialize saved model
  const savedModel = localStorage.getItem('coden-selected-model') || 'auto';
  let foundModel = false;
  modelOptions.forEach(opt => {
    if ((opt as HTMLElement).dataset.id === savedModel) {
      modelOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      if (modelLabel) modelLabel.textContent = (opt as HTMLElement).dataset.name || 'Auto';
      foundModel = true;
    }
  });
  if (!foundModel && modelLabel) {
    const activeOpt = document.querySelector('.model-option.active') as HTMLElement;
    if (activeOpt) {
      modelLabel.textContent = activeOpt.dataset.name || 'Auto';
    }
  }

  modelOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      modelOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const modelId = (opt as HTMLElement).dataset.id || 'auto';
      const modelName = (opt as HTMLElement).dataset.name || 'Auto';
      localStorage.setItem('coden-selected-model', modelId);
      if (modelLabel) modelLabel.textContent = modelName;
      modelDropdown?.classList.remove('open');
    });
  });

  // Model search filtering & event isolation
  const dropdownSearch = modelDropdown?.querySelector('.dropdown-search-input') as HTMLInputElement;
  dropdownSearch?.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
    modelOptions.forEach(opt => {
      const name = (opt as HTMLElement).dataset.name?.toLowerCase() || '';
      const desc = (opt as HTMLElement).querySelector('.opt-desc')?.textContent?.toLowerCase() || '';
      if (name.includes(query) || desc.includes(query)) {
        (opt as HTMLElement).style.display = 'flex';
      } else {
        (opt as HTMLElement).style.display = 'none';
      }
    });
  });
  dropdownSearch?.addEventListener('keydown', (e) => {
    e.stopPropagation();
  });
  dropdownSearch?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  function handleSend() {
    const text = chatTextarea.value.trim();
    if (!text) return;
    const container = document.getElementById('chat-container');
    if (container) {
      const msg = document.createElement('div');
      msg.className = 'msg-user';
      msg.innerHTML = `<div class="msg-user-bubble">${text}</div><div class="msg-time">just now</div>`;
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
      chatTextarea.value = '';
      chatTextarea.style.height = 'auto';
      btnSend.disabled = true;

      setTimeout(() => {
        const sysMsg = document.createElement('div');
        sysMsg.className = 'msg-system';
        if (currentMode === 'plan') {
          sysMsg.innerHTML = '── plan ready ──';
        } else {
          sysMsg.innerHTML = '── build event received ──';
        }
        container.appendChild(sysMsg);
        container.scrollTop = container.scrollHeight;
      }, 2000);

      addToHistory(`Chat: ${text.substring(0, 20)}...`);
    }
  }

  if (chatTextarea && btnSend) {
    chatTextarea.addEventListener('input', () => {
      btnSend.disabled = chatTextarea.value.trim() === '';
      chatTextarea.style.height = 'auto';
      chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 160) + 'px';
    });
    chatTextarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatTextarea.value.trim()) handleSend();
      }
    });
    btnSend.onclick = handleSend;
  }

  // ── COPY CODE ────────────────────────────────────────────────
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard!');
    });
  }

  document.getElementById('btn-copy')?.addEventListener('click', function() {
    const code = codeLines.map(l => {
      const temp = document.createElement('div');
      temp.innerHTML = l[0] as string;
      return temp.textContent || '';
    }).join('\n');
    copyToClipboard(code);
    this.textContent = 'Copied!';
    addToHistory(`Copied editor code`);
    setTimeout(() => { this.textContent = 'Copy'; }, 1500);
  });

  document.getElementById('btn-copy-preview')?.addEventListener('click', function() {
    const code = previewCode?.textContent || '';
    copyToClipboard(code);
    this.textContent = 'Copied!';
    addToHistory(`Copied preview code`);
    setTimeout(() => { this.textContent = 'Copy'; }, 1500);
  });

  // ── DRAG RESIZE ─────────────────────────────────────────────
  function initResize() {
    const handleR = document.getElementById('handle-right');
    const layout = document.querySelector('.app-layout') as HTMLElement;
    
    if (handleR) {
        handleR.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = mainPanel.offsetWidth;
        handleR.classList.add('dragging');
        const move = (ev: MouseEvent) => {
          const delta = ev.clientX - startX;
          const maxW = Math.max(360, window.innerWidth * 0.45); // Max 45% or 360px
          const w = Math.max(300, Math.min(startW + delta, maxW)); 
          layout.style.setProperty('--side-w', w + 'px');
          layout.style.gridTemplateColumns = `${w}px 4px 1fr`;
        };
        const up = () => {
          handleR.classList.remove('dragging');
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    }
  }
  initResize();

  // ── THEME TOGGLE ─────────────────────────────────────────────
  const html = document.documentElement;
  const curtain = document.getElementById('curtain');
  
  const liftCurtain = () => {
    if (curtain) curtain.classList.add('rising');
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    liftCurtain();
  } else {
    window.addEventListener('load', liftCurtain);
  }

  function navigate(url: string) {
    if (curtain) {
      curtain.classList.remove('rising');
      curtain.classList.add('falling');
      setTimeout(() => {
        window.location.href = url;
      }, 600);
    } else {
      window.location.href = url;
    }
  }

  // Intercept logo click
  document.querySelector('.logo')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });

  document.getElementById('btn-theme-builder')?.addEventListener('click', () => {
    const isDark = html.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    localStorage.setItem('coden-theme', newTheme);
    
    if (curtain) {
      curtain.style.background = isDark ? '#fcfbf8' : '#0f1014';
      curtain.style.transformOrigin = 'top';
      curtain.classList.add('falling');
      setTimeout(() => {
        html.setAttribute('data-theme', newTheme);
        curtain.classList.remove('falling');
        requestAnimationFrame(() => {
          curtain.style.transformOrigin = 'bottom';
          curtain.classList.add('rising');
          setTimeout(() => {
            curtain.classList.remove('rising');
          }, 620);
        });
      }, 600);
    }
  });

  // ── UNDO / REDO MOCK ──────────────────────────────────────────
  let history: string[] = [];
  let historyIndex = -1;

  function addToHistory(action: string) {
    history = history.slice(0, historyIndex + 1);
    history.push(action);
    historyIndex++;
    console.log(`History: ${action} pushed`);
  }

  document.getElementById('btn-undo')?.addEventListener('click', () => {
    if (historyIndex >= 0) {
      const action = history[historyIndex];
      historyIndex--;
      console.log(`Undid: ${action}`);
      showToast(`Undid: ${action}`);
    }
  });

  document.getElementById('btn-redo')?.addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      const action = history[historyIndex];
      console.log(`Redid: ${action}`);
      showToast(`Redid: ${action}`);
    }
  });

  function showToast(msg: string) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 48px; left: 50%; transform: translateX(-50%);
      background: var(--bg-elevated); color: var(--text); padding: 8px 16px;
      border-radius: 6px; border: 1px solid var(--border-mid); font-size: 12px;
      z-index: 10000; animation: toastIn 0.3s ease forwards;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // Add styles for toast
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 20px); } to { opacity: 1; transform: translate(-50%, 0); } }
    @keyframes toastOut { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, 20px); } }
  `;
  document.head.appendChild(style);

  // ── COLLAPSE LOGIC ────────────────────────────────────────────
  const btnCollapse = document.getElementById('btn-collapse-chat');

  btnCollapse?.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    btnCollapse.classList.toggle('collapsed', isCollapsed);
    updateLayout();
  });

  document.getElementById('btn-upgrade')?.addEventListener('click', () => {
    navigate('/pricing.html');
  });

  // ── KEYBOARD SHORTCUTS ────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        document.getElementById('btn-redo')?.click();
      } else {
        document.getElementById('btn-undo')?.click();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
      e.preventDefault();
      document.getElementById('btn-redo')?.click();
    }
  });

  // ── INITIALIZE ────────────────────────────────────────────────
  updateLayout();

  // Check for initial prompt sync
  const initialPrompt = sessionStorage.getItem('coden-initial-prompt');
  if (initialPrompt && chatTextarea) {
    chatTextarea.value = initialPrompt;
    handleSend();
    sessionStorage.removeItem('coden-initial-prompt');
  }

  console.log('Builder initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBuilder);
} else {
  initBuilder();
}
