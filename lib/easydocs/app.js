import { $, el, toast, busy, modal, alertBox, confirmBox, saveBlob, downloadBlob } from './ui.js';
import { createWordEditor } from './word.js';
import { createSheetEditor } from './sheet.js';
import { createPdfEditor } from './pdf.js';
import { createTextEditor } from './text.js';
import { isNativeApp, saveToDevice, shareFile } from './native.js';

const KINDS = {
  pdf: { exts: ['pdf'], factory: createPdfEditor, label: 'PDF' },
  word: { exts: ['docx'], factory: createWordEditor, label: 'DOCX' },
  sheet: { exts: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv'], factory: createSheetEditor, label: 'Sheet' },
  image: { exts: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'], factory: createPdfEditor, label: 'Image' },
  text: { exts: ['txt', 'md', 'markdown', 'json', 'html', 'htm', 'xml', 'js', 'mjs', 'ts', 'css', 'log', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'svg', 'py', 'java', 'c', 'cpp', 'h', 'sh', 'sql', 'env', 'rtf'], factory: createTextEditor, label: 'Text' },
};
const UNSUPPORTED = {
  doc: 'Old Word .doc files can’t be opened here. In Word, use “Save As” → .docx, then open it again.',
  ppt: 'PowerPoint files aren’t supported yet. You can export them to PDF and edit the PDF here.',
  pptx: 'PowerPoint files aren’t supported yet. You can export them to PDF and edit the PDF here.',
  pages: 'Apple Pages files can’t be opened. Export to Word (.docx) or PDF first.',
  numbers: 'Apple Numbers files can’t be opened. Export to Excel (.xlsx) or CSV first.',
};

const state = { editor: null, kind: null, dirty: false, ext: '' };

const splitName = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i + 1).toLowerCase()] : [name, ''];
};

function kindForExt(ext) {
  for (const [k, v] of Object.entries(KINDS)) if (v.exts.includes(ext)) return k;
  return null;
}

async function looksLikeText(file) {
  const buf = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  let bad = 0;
  for (const b of buf) if (b === 0 || (b < 9) || (b > 13 && b < 32 && b !== 27)) bad++;
  return bad / Math.max(1, buf.length) < 0.02;
}

// ---------- open / create ----------
async function openFile(file) {
  if (!file) return;
  if (!(await leaveEditor())) return;
  const [base, ext] = splitName(file.name);
  let kind = kindForExt(ext);
  if (!kind && file.type === 'application/pdf') kind = 'pdf';
  if (!kind && file.type.startsWith('image/')) kind = 'image';
  if (!kind && UNSUPPORTED[ext]) return alertBox('Can’t open this file', UNSUPPORTED[ext]);
  if (!kind && (await looksLikeText(file))) kind = 'text';
  if (!kind) return alertBox('Can’t open this file', `“${file.name}” isn’t a type EasyDocs can edit. Try PDF, Word (.docx), Excel (.xlsx/.xls), CSV, text or image files.`);
  await startEditor(kind, file, base, ext);
}

async function createNew(kind) {
  if (!(await leaveEditor())) return;
  const names = { word: ['Untitled document', 'docx'], sheet: ['Untitled spreadsheet', 'xlsx'], pdf: ['Untitled', 'pdf'], text: ['Untitled', 'txt'] };
  const [base, ext] = names[kind];
  await startEditor(kind, null, base, ext);
}

async function startEditor(kind, file, base, ext) {
  busy(true, file ? `Opening ${file.name}…` : 'Creating…');
  const toolbar = $('#toolbar'), workspace = $('#workspace'), status = $('#status');
  toolbar.replaceChildren(); workspace.replaceChildren(); status.replaceChildren();
  toolbar.scrollLeft = 0;
  $('#home').hidden = true;
  $('#editor').hidden = false;
  $('#fileName').value = base;
  fitName();
  state.kind = kind; state.ext = ext; state.dirty = false;
  const badge = $('#kindBadge');
  badge.className = 'badge ' + kind;
  badge.textContent = kind === 'word' ? 'Doc' : kind === 'sheet' ? 'Sheet' : kind === 'image' ? 'Img' : kind === 'text' ? 'Text' : 'PDF';
  try {
    state.editor = await KINDS[kind].factory({
      file, ext, kind, toolbar, workspace, status,
      markDirty: () => { state.dirty = true; },
    });
    updateExtLabel();
    if (!file) state.dirty = false;
    history.pushState({ editing: true }, '');
  } catch (err) {
    console.error(err);
    showHome();
    alertBox('Couldn’t open the file', err?.userMessage || `This file looks damaged or uses features we can’t read. (${err?.message || err})`);
  } finally {
    busy(false);
  }
}

function fitName() {
  const n = $('#fileName');
  n.style.width = Math.min(Math.max(n.value.length + 2, 6), 48) + 'ch';
}

function updateExtLabel() {
  const def = state.editor?.exports?.[0];
  $('#extLabel').textContent = def ? '.' + def.ext : '';
}

function showHome() {
  state.editor?.destroy?.();
  state.editor = null;
  state.dirty = false;
  $('#editor').hidden = true;
  $('#home').hidden = false;
  $('#toolbar').replaceChildren(); $('#workspace').replaceChildren(); $('#status').replaceChildren();
  $('#fileInput').value = '';
}

async function leaveEditor() {
  if (!state.editor) return true;
  if (state.dirty && !(await confirmBox('Close without saving?', 'You have changes that haven’t been saved. They will be lost.', 'Close anyway', true))) return false;
  showHome();
  return true;
}

// ---------- save / share ----------
function fileBase() {
  return ($('#fileName').value.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-');
}

async function runExport(exp) {
  $('#saveMenu').hidden = true;
  if (!exp) return;
  if (exp.print) { exp.print(fileBase()); return; }
  const filename = `${fileBase()}.${exp.ext}`;
  if (isNativeApp()) return saveInApp(exp, filename);
  try {
    const ok = await saveBlob(async () => {
      busy(true, 'Saving…');
      return exp.build();
    }, filename, exp.mime);
    if (ok) {
      state.dirty = false;
      toast(`Saved “${filename}”`);
    }
  } catch (err) {
    console.error(err);
    alertBox('Couldn’t save', err?.message || String(err));
  } finally {
    busy(false);
  }
}

// Android app: save into Documents/EasyDocs, then offer to share it
async function saveInApp(exp, filename) {
  let blob;
  try {
    busy(true, 'Saving…');
    blob = await exp.build();
    const where = await saveToDevice(blob, filename);
    state.dirty = false;
    busy(false);
    toast(`Saved to ${where}`, 4000);
  } catch (err) {
    busy(false);
    console.error(err);
    if (!blob) return alertBox('Couldn’t save', err?.message || String(err));
    // Couldn't write to Documents (e.g. storage permission refused): let the user pick a place via the share sheet
    const ok = await confirmBox('Couldn’t save to Documents', 'You can still save it with another app, for example Files or Google Drive.', 'Choose where to save');
    if (ok) shareFile(blob, filename).catch((e) => alertBox('Couldn’t share', e?.message || String(e)));
  }
}

async function share() {
  const exp = state.editor?.exports?.find((e) => e.build);
  if (!exp) return;
  const filename = `${fileBase()}.${exp.ext}`;
  let blob;
  try {
    busy(true, 'Preparing…');
    blob = await exp.build();
  } catch (err) {
    busy(false);
    return alertBox('Couldn’t prepare the file', err?.message || String(err));
  }
  busy(false);
  if (isNativeApp()) {
    try { await shareFile(blob, filename); } catch (err) { alertBox('Couldn’t share', err?.message || String(err)); }
    return;
  }
  const file = new File([blob], filename, { type: exp.mime });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  if (canShare) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Browser needed a fresh tap (file took long to prepare): ask once more below.
      if (err.name !== 'NotAllowedError') console.warn(err);
    }
  }
  modal((close) => el('div', {},
    el('h3', {}, 'Share “' + filename + '”'),
    canShare
      ? el('p', {}, 'Tap Share to send it to WhatsApp, email, Drive, AirDrop or any other app.')
      : el('p', {}, 'This browser can’t send files to other apps directly. Download the file, then attach it in email, WhatsApp, Drive or any app you like. (On phones, and in Chrome, Edge and Safari, the Share button opens the share sheet directly.)'),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
      el('button', { class: 'btn', onclick: () => { downloadBlob(blob, filename); close(); } }, 'Download'),
      canShare ? el('button', {
        class: 'btn primary',
        onclick: async () => { close(); try { await navigator.share({ files: [file], title: filename }); } catch {} },
      }, 'Share') : null)));
}

function openSaveMenu() {
  const menu = $('#saveMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.replaceChildren(el('div', { class: 'menu-title' }, 'Save as'));
  // Printing isn't available inside the Android app, so "PDF via print" options are hidden there
  for (const exp of (state.editor?.exports || []).filter((e) => !(e.print && isNativeApp()))) {
    menu.append(el('button', { onclick: () => runExport(exp) }, el('span', {}, exp.label), el('small', {}, exp.hint || '.' + exp.ext)));
  }
  menu.hidden = false;
}

// ---------- wiring ----------
let started = false;

// Called once by components/EasyDocs.tsx after the file libraries in /public/vendor have loaded.
export function init() {
  if (started) return;
  started = true;
  $('#home').classList.remove('loading'); // buttons work from here on
  const input = $('#fileInput');
  input.addEventListener('change', () => openFile(input.files[0]));
  const dz = $('#dropzone');
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (!$('#home').hidden) dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f && !$('#home').hidden) openFile(f);
  });
  document.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => createNew(b.dataset.new)));

  $('#backBtn').addEventListener('click', () => leaveEditor());
  $('#saveBtn').addEventListener('click', () => runExport(state.editor?.exports?.[0]));
  $('#saveMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); openSaveMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.split')) $('#saveMenu').hidden = true; });
  $('#shareBtn').addEventListener('click', share);
  $('#fileName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#fileName').addEventListener('input', fitName);

  // Ctrl/Cmd + S saves
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.editor) {
      e.preventDefault();
      runExport(state.editor.exports[0]);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.editor && state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  // Phone back button returns to the home screen instead of leaving the app
  window.addEventListener('popstate', async () => {
    if (state.editor && !(await leaveEditor())) history.pushState({ editing: true }, '');
  });

  // Files opened with the installed app (desktop "Open with…")
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const h = params.files?.[0];
      if (h) openFile(await h.getFile());
    });
  }

  // Install button
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; });

  // Offline support only in production builds (it would cache dev files during `next dev`)
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production' && !isNativeApp()) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
