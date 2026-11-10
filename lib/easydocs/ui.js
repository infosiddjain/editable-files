// Small shared UI helpers: toast, busy overlay, modals, toolbar buttons, saving files.

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

export function busy(on, text = 'Working…') {
  $('#busyText').textContent = text;
  $('#busy').hidden = !on;
}

// Generic modal. `build(close)` returns the content node. Resolves with whatever close() is called with.
export function modal(build) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'modal-back' });
    const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    box.append(build(close));
    back.append(box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    document.addEventListener('keydown', onKey);
    $('#modalRoot').append(back);
    const first = box.querySelector('input, textarea, select, button.primary');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export function alertBox(title, message) {
  return modal((close) => el('div', {},
    el('h3', {}, title),
    el('p', {}, message),
    el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => close(true) }, 'OK'))));
}

export function confirmBox(title, message, okText = 'OK', danger = false) {
  return modal((close) => el('div', {},
    el('h3', {}, title),
    el('p', {}, message),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
      el('button', { class: 'btn primary' + (danger ? ' danger' : ''), onclick: () => close(true) }, okText))));
}

export function promptBox(title, label, value = '', type = 'text') {
  return modal((close) => {
    const input = el('input', { type, value });
    const submit = () => close(input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    return el('div', {},
      el('h3', {}, title),
      label ? el('p', {}, label) : null,
      input,
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: submit }, 'OK')));
  });
}

// Toolbar helpers
export function tbButton(label, title, onClick, extraClass = '') {
  const b = el('button', { class: 'tb ' + extraClass, title, 'aria-label': title, type: 'button' });
  b.innerHTML = label;
  // Keep focus (and text selection) in editors when clicking toolbar buttons
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}
export const tbSep = () => el('span', { class: 'sep' });
export function tbColor(title, value, onInput, glyph = 'A') {
  const wrap = el('label', { class: 'tb tb-color', title });
  const sw = el('span', { class: 'swatch', style: { background: value } });
  const input = el('input', { type: 'color', value, 'aria-label': title });
  input.addEventListener('input', () => { sw.style.background = input.value; onInput(input.value); });
  wrap.append(el('span', { html: glyph }), sw, input);
  wrap.input = input;
  return wrap;
}
export function tbSelect(title, options, onChange) {
  const s = el('select', { class: 'tb-select', title, 'aria-label': title });
  for (const [value, label] of options) s.append(el('option', { value }, label));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function readAsDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.click();
  });
}

// Save a file to the user's computer/phone.
// Uses the "Save as" dialog where the browser supports it, otherwise a normal download.
export async function saveBlob(buildBlob, filename, mime) {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
  if (window.showSaveFilePicker && window.isSecureContext) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: ext ? [{ description: ext.slice(1).toUpperCase() + ' file', accept: { [mime || 'application/octet-stream']: [ext] } }] : undefined,
      });
    } catch (e) {
      if (e.name === 'AbortError') return false; // user cancelled
      handle = null; // picker failed for another reason: fall back to download
    }
    if (handle) {
      const blob = await buildBlob();
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    }
  }
  const blob = await buildBlob();
  downloadBlob(blob, filename);
  return true;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Print some HTML (used for "Save as PDF" from documents and spreadsheets).
export function printHTML(title, bodyHTML, css = '') {
  const frame = el('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(title)}</title>
<style>body{font:12pt/1.5 Calibri,Carlito,Arial,sans-serif;color:#000;margin:0}img{max-width:100%}
table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 6px;vertical-align:top}
@page{margin:18mm}${css}</style></head><body>${bodyHTML}</body></html>`);
  doc.close();
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  // wait for images
  const imgs = [...doc.images].filter((i) => !i.complete);
  if (!imgs.length) setTimeout(go, 50);
  else Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))).then(go);
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
