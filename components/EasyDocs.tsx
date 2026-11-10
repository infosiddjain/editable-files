'use client';

import Image from 'next/image';
import { useEffect } from 'react';

// File libraries served from /public/vendor (pdf.js, pdf-lib, mammoth, SheetJS, docx).
// They are loaded in order as plain scripts, then the editor code starts.
const LIBS = ['pdf.min.js', 'pdf-lib.min.js', 'mammoth.browser.min.js', 'xlsx.full.min.js', 'docx.umd.js'];

function loadScript(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-easydocs="${name}"]`);
    if (existing) {
      if (existing.dataset.loaded) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load ' + name)));
      return;
    }
    const s = document.createElement('script');
    s.src = '/vendor/' + name;
    s.async = false; // keep order
    s.dataset.easydocs = name;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('Failed to load ' + name));
    document.head.append(s);
  });
}

export default function EasyDocs() {
  useEffect(() => {
    let cancelled = false;
    Promise.all(LIBS.map(loadScript))
      .then(() => import('@/lib/easydocs/app'))
      .then((m) => { if (!cancelled) m.init(); })
      .catch((err) => console.error('EasyDocs failed to start', err));
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      {/* Home screen */}
      <main id="home" className="home loading">
        <header className="home-head">
          <div className="brand">
            <Image src="/icons/icon.svg" alt="" width={36} height={36} unoptimized priority />
            <span>EasyDocs</span>
          </div>
          <button id="installBtn" className="btn ghost" hidden>Install app</button>
        </header>

        <section className="hero">
          <h1>Edit any document, right here.</h1>
          <p>PDF, Word, Excel, CSV and text files. Your files never leave your device.</p>
        </section>

        <label id="dropzone" className="dropzone" tabIndex={0}>
          <input
            id="fileInput"
            type="file"
            hidden
            accept=".pdf,.docx,.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt,.md,.json,.html,.htm,.xml,.js,.css,.log,.yml,.yaml,.ini,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/*,text/*"
          />
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          <strong>Choose a file to edit</strong>
          <span className="loading-note">Loading editor…</span>
          <span>or drag and drop it here</span>
          <div className="chips">
            <span className="chip pdf">PDF</span>
            <span className="chip word">Word .docx</span>
            <span className="chip sheet">Excel .xlsx .xls</span>
            <span className="chip sheet">CSV</span>
            <span className="chip text">Text .txt .md .json .html</span>
            <span className="chip img">Images</span>
          </div>
        </label>

        <section className="create">
          <h2>Or start a new file</h2>
          <div className="create-grid">
            <button className="create-card" data-new="word"><span className="ico word">W</span><b>Document</b><small>Word .docx</small></button>
            <button className="create-card" data-new="sheet"><span className="ico sheet">X</span><b>Spreadsheet</b><small>Excel .xlsx</small></button>
            <button className="create-card" data-new="pdf"><span className="ico pdf">P</span><b>Blank PDF</b><small>.pdf</small></button>
            <button className="create-card" data-new="text"><span className="ico text">T</span><b>Text note</b><small>.txt</small></button>
          </div>
        </section>

        <footer className="home-foot">Works offline. Nothing is uploaded: files are opened and saved only on this device.</footer>
      </main>

      {/* Editor screen (filled in by lib/easydocs) */}
      <section id="editor" className="editor" hidden>
        <header className="topbar">
          <button id="backBtn" className="icon-btn" title="Close file" aria-label="Close file">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span id="kindBadge" className="badge" />
          <input id="fileName" className="file-name" spellCheck={false} aria-label="File name" />
          <span id="extLabel" className="ext" />
          <div className="spacer" />
          <button id="shareBtn" className="btn ghost" title="Share">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
            </svg>
            <span className="hide-sm">Share</span>
          </button>
          <div className="split">
            <button id="saveBtn" className="btn primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" />
              </svg>
              <span>Save</span>
            </button>
            <button id="saveMenuBtn" className="btn primary caret" aria-label="Save as another format" title="Save as…">▾</button>
            <div id="saveMenu" className="menu" hidden />
          </div>
        </header>
        <div id="toolbar" className="toolbar" />
        <div id="workspace" className="workspace" />
        <footer id="status" className="status" />
      </section>

      <div id="modalRoot" />
      <div id="toast" className="toast" hidden />
      <div id="busy" className="busy" hidden>
        <div className="spinner" />
        <span id="busyText">Working…</span>
      </div>
    </>
  );
}
