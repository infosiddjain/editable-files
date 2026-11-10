// PDF editor (also used for images, which are wrapped in a one-page PDF).
// Shows pages with pdf.js, keeps edits as overlay items, writes them into the PDF with pdf-lib on save.
import { el, tbButton, tbSep, tbColor, tbSelect, toast, pickFile, readAsDataURL, modal, alertBox } from './ui.js';

const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } = window.PDFLib;
window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';

const A4 = [595.28, 841.89];
const FONT_CSS = { sans: 'Helvetica, Arial, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
// Where the first line's baseline sits inside a 1.2 line-height box (as a fraction of font size)
const BASELINE = { sans: 0.947, serif: 0.938, mono: 0.867 };
const PDF_FONT = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold],
};

const ICON = {
  text: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
  erase: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M16 3l5 5-11 11H5v-5z"/><path d="M5 21h14"/></svg>',
  hl: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 11l6-6 4 4-6 6z"/><path d="M9 11l-4 4v3h3l4-4"/><path d="M3 21h18" stroke-width="3" stroke="#f5c400"/></svg>',
  pen: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3-1 5-4 7-6l9-9a2 2 0 0 0-3-3l-9 9c-2 2-3 5-4 9z"/></svg>',
  move: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l7 17 2-7 7-2z"/></svg>',
  img: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  sign: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3 0 4-9 6-9s0 9 3 9 3-5 5-5 2 3 4 3"/><path d="M3 21h18"/></svg>',
  undo: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
};

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

// Image file -> { bytes (png/jpg), format, width, height }
async function normalizeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const isJpg = /jpe?g/i.test(file.type);
    const isPng = /png/i.test(file.type);
    if (isJpg || isPng) return { bytes: new Uint8Array(await file.arrayBuffer()), format: isJpg ? 'jpg' : 'png', width: img.naturalWidth, height: img.naturalHeight, mime: file.type };
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'png', width: c.width, height: c.height, mime: 'image/png' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createPdfEditor({ file, kind, ext, toolbar, workspace, status, markDirty }) {
  // ---------- load ----------
  let imageInfo = null;
  let firstBytes;
  if (kind === 'image') {
    imageInfo = await normalizeImage(file);
    const doc = await PDFDocument.create();
    const emb = imageInfo.format === 'jpg' ? await doc.embedJpg(imageInfo.bytes) : await doc.embedPng(imageInfo.bytes);
    const pg = doc.addPage([imageInfo.width, imageInfo.height]);
    pg.drawImage(emb, { x: 0, y: 0, width: imageInfo.width, height: imageInfo.height });
    firstBytes = await doc.save();
  } else if (file) {
    firstBytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const doc = await PDFDocument.create();
    doc.addPage(A4);
    firstBytes = await doc.save();
  }

  const sources = [];
  async function addSource(bytes) {
    let pdf;
    try {
      pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    } catch (e) {
      const err = new Error(e.message);
      err.userMessage = e.name === 'PasswordException'
        ? 'This PDF is password-protected. Remove the password (for example by printing it to a new PDF) and try again.'
        : 'This PDF couldn’t be read. It may be damaged.';
      throw err;
    }
    try {
      await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      const err = new Error(e.message);
      err.userMessage = /encrypt/i.test(e.message)
        ? 'This PDF is protected against editing, so changes can’t be saved. Remove the protection first (for example, print it to a new PDF), then open the new file.'
        : 'This PDF uses a structure we can’t edit. (' + e.message + ')';
      throw err;
    }
    sources.push({ bytes, pdf });
    return sources.length - 1;
  }
  await addSource(firstBytes);

  // ---------- state ----------
  const pages = []; // { src, index, pdfPage, vp1, w, h, origRot, rot, deleted, items, strokes, dom... }
  let S = 1; // zoom: CSS px per PDF point
  let tool = 'text';
  let selected = null; // { page, item }
  const style = { font: 'sans', size: 14, bold: false, color: '#111111', pen: '#1d4ed8', penWidth: 2 };
  const undoStack = [];
  const pushUndo = (fn) => { undoStack.push(fn); if (undoStack.length > 200) undoStack.shift(); markDirty(); };
  let unsupportedChars = false;

  const container = el('div', { class: 'pdf-pages' });
  workspace.append(container);

  // ---------- toolbar ----------
  const toolBtns = {};
  const toolBtn = (id, icon, label, title) => {
    const b = tbButton(`${icon}<span class="hide-sm">${label}</span>`, title, () => setTool(id));
    toolBtns[id] = b;
    return b;
  };
  const fontSel = tbSelect('Font', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']], (v) => applyStyle({ font: v }));
  const sizeSel = tbSelect('Font size', [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((n) => [String(n), String(n)]), (v) => applyStyle({ size: +v }));
  sizeSel.value = '14';
  const boldBtn = tbButton('<b>B</b>', 'Bold', () => applyStyle({ bold: !style.bold }));
  const colorPick = tbColor('Text color', style.color, (c) => applyStyle({ color: c }), '<b>A</b>');
  const penPick = tbColor('Pen color', style.pen, (c) => { style.pen = c; }, '✎');
  const penWidth = tbSelect('Pen size', [['1', 'Thin'], ['2', 'Medium'], ['4', 'Thick'], ['8', 'Marker']], (v) => { style.penWidth = +v; });
  penWidth.value = '2';
  const zoomLabel = el('span', { style: { fontSize: '13px', minWidth: '44px', textAlign: 'center', color: 'var(--muted)' } });

  toolbar.append(
    tbButton(ICON.undo, 'Undo (Ctrl+Z)', () => undo()),
    tbSep(),
    toolBtn('text', ICON.text, 'Text', 'Text: click existing text to change it, or click anywhere to add new text'),
    toolBtn('whiteout', ICON.erase, 'Erase', 'Erase: drag a box to cover (white-out) part of the page'),
    toolBtn('highlight', ICON.hl, 'Highlight', 'Highlight: drag over text'),
    toolBtn('draw', ICON.pen, 'Draw', 'Draw freehand'),
    toolBtn('select', ICON.move, 'Move', 'Select and move things you added'),
    tbSep(),
    tbButton(`${ICON.img}<span class="hide-sm">Image</span>`, 'Add a picture', () => addImage()),
    tbButton(`${ICON.sign}<span class="hide-sm">Sign</span>`, 'Add your signature', () => addSignature()),
    tbSep(),
    fontSel, sizeSel, boldBtn, colorPick,
    tbSep(),
    penPick, penWidth,
    tbSep(),
    tbButton('−', 'Zoom out', () => setZoom(S / 1.2)),
    zoomLabel,
    tbButton('+', 'Zoom in', () => setZoom(S * 1.2)),
    tbSep(),
    tbButton('+ Page', 'Add a blank page at the end', () => addBlankPage()),
    kind === 'image' ? null : tbButton('+ PDF', 'Add the pages of another PDF at the end (merge)', () => mergePdf()),
  );

  function setTool(t) {
    tool = t;
    for (const [id, b] of Object.entries(toolBtns)) b.classList.toggle('active', id === t);
    for (const p of pages) {
      p.overlay.className = 'overlay t-' + t;
      if (t === 'text') ensureHits(p);
    }
    if (t !== 'select' && selected && selected.item.type !== 'text') selectItem(null);
  }

  function applyStyle(change) {
    Object.assign(style, change);
    fontSel.value = style.font; sizeSel.value = String(style.size);
    boldBtn.classList.toggle('active', style.bold);
    if (change.color) { colorPick.input.value = style.color; colorPick.querySelector('.swatch').style.background = style.color; }
    if (selected?.item.type === 'text') {
      const it = selected.item;
      const before = { font: it.font, size: it.size, bold: it.bold, color: it.color };
      Object.assign(it, change);
      positionItem(selected.page, it);
      const pg = selected.page;
      pushUndo(() => { Object.assign(it, before); positionItem(pg, it); });
    }
  }

  // ---------- pages ----------
  async function addPagesFromSource(si) {
    const pdf = sources[si].pdf;
    for (let i = 1; i <= pdf.numPages; i++) {
      const pdfPage = await pdf.getPage(i);
      const vp1 = pdfPage.getViewport({ scale: 1 });
      createPage({ src: si, index: i - 1, pdfPage, vp1, w: vp1.width, h: vp1.height, origRot: pdfPage.rotate || 0 });
    }
  }

  function createPage(p) {
    Object.assign(p, { rot: 0, deleted: false, items: [], strokes: [], renderedAt: null, hits: null });
    p.canvas = el('canvas');
    p.drawCanvas = el('canvas');
    p.overlay = el('div', { class: 'overlay t-' + tool });
    p.pageEl = el('div', { class: 'pdf-page' }, p.canvas, p.drawCanvas, p.overlay);
    p.holder = el('div', { class: 'page-holder' }, p.pageEl);
    p.label = el('span');
    const small = (html, title, fn) => tbButton(html, title, fn);
    p.bar = el('div', { class: 'page-bar' }, p.label, el('span', {},
      small('↑', 'Move page up', () => movePage(p, -1)),
      small('↓', 'Move page down', () => movePage(p, 1)),
      small('↻', 'Rotate page', () => rotatePage(p)),
      small('🗑', 'Delete page', () => deletePage(p))));
    p.wrap = el('div', { class: 'page-wrap' }, p.bar, p.holder);
    p.holder._page = p;
    container.append(p.wrap);
    pages.push(p);
    wireOverlay(p);
    layoutPage(p);
    observer.observe(p.holder);
    return p;
  }

  function layoutPage(p) {
    const w = p.w * S, h = p.h * S;
    const sideways = p.rot % 180 !== 0;
    Object.assign(p.holder.style, { width: (sideways ? h : w) + 'px', height: (sideways ? w : h) + 'px' });
    p.wrap.style.width = (sideways ? h : w) + 'px';
    Object.assign(p.pageEl.style, { width: w + 'px', height: h + 'px', transform: `translate(-50%, -50%) rotate(${p.rot}deg)` });
    for (const it of p.items) positionItem(p, it);
    if (p.hits) p.hits.forEach(positionHit);
    sizeDrawCanvas(p);
  }

  function relabel() {
    const live = pages.filter((p) => !p.deleted);
    live.forEach((p, i) => { p.label.textContent = `Page ${i + 1} of ${live.length}`; });
    pageInfo.textContent = `${live.length} page${live.length === 1 ? '' : 's'}`;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = e.target._page;
      p.visible = e.isIntersecting;
      if (e.isIntersecting) renderPage(p);
      else if (p.renderedAt !== null) { // free memory for far-away pages
        p.renderTask?.cancel();
        p.canvas.width = 0; p.canvas.height = 0; p.renderedAt = null;
      }
    }
  }, { root: workspace, rootMargin: '600px 0px' });

  async function renderPage(p) {
    if (p.renderedAt === S || p.rendering) return;
    const zoom = S;
    p.rendering = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // keep canvases within browser limits
    const scale = Math.min(zoom * dpr, 4096 / Math.max(p.w, p.h));
    if (!p.pdfPage) {
      p.canvas.width = Math.round(p.w * scale); p.canvas.height = Math.round(p.h * scale);
      const ctx = p.canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p.canvas.width, p.canvas.height);
    } else {
      const vp = p.pdfPage.getViewport({ scale });
      const off = document.createElement('canvas');
      off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
      p.renderTask = p.pdfPage.render({ canvasContext: off.getContext('2d'), viewport: vp });
      try {
        await p.renderTask.promise;
        p.canvas.width = off.width; p.canvas.height = off.height;
        p.canvas.getContext('2d').drawImage(off, 0, 0);
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') console.warn(e);
        p.rendering = false;
        return;
      }
    }
    p.rendering = false;
    p.renderedAt = zoom;
    if (zoom !== S && p.visible) renderPage(p);
    if (tool === 'text') ensureHits(p);
  }

  function sizeDrawCanvas(p) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    p.drawCanvas.width = Math.round(p.w * S * dpr);
    p.drawCanvas.height = Math.round(p.h * S * dpr);
    redrawStrokes(p);
  }
  function redrawStrokes(p) {
    const c = p.drawCanvas, ctx = c.getContext('2d');
    const k = c.width / p.w;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of p.strokes) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width * k;
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * k + 0.01, s.pts[0][1] * k);
      ctx.stroke();
    }
  }

  function setZoom(z) {
    S = Math.max(0.25, Math.min(z, 4));
    zoomLabel.textContent = Math.round(S * 100) + '%';
    for (const p of pages) { layoutPage(p); if (p.visible) renderPage(p); }
  }

  function movePage(p, dir) {
    const live = pages.filter((x) => !x.deleted);
    const i = live.indexOf(p), j = i + dir;
    if (j < 0 || j >= live.length) return;
    const other = live[j];
    const swap = () => {
      const ia = pages.indexOf(p), ib = pages.indexOf(other);
      [pages[ia], pages[ib]] = [pages[ib], pages[ia]];
      pages.forEach((x) => container.append(x.wrap));
      relabel();
    };
    swap();
    pushUndo(swap);
    p.wrap.scrollIntoView({ block: 'nearest' });
  }
  function rotatePage(p) {
    p.rot = (p.rot + 90) % 360; layoutPage(p);
    pushUndo(() => { p.rot = (p.rot + 270) % 360; layoutPage(p); });
  }
  function deletePage(p) {
    if (pages.filter((x) => !x.deleted).length === 1) return toast('A PDF needs at least one page');
    p.deleted = true; p.wrap.hidden = true; relabel();
    pushUndo(() => { p.deleted = false; p.wrap.hidden = false; relabel(); });
    toast('Page deleted. Press Undo to bring it back.');
  }
  function addBlankPage() {
    const last = [...pages].reverse().find((x) => !x.deleted);
    const [w, h] = last && !imageInfo ? [last.rot % 180 ? last.h : last.w, last.rot % 180 ? last.w : last.h] : A4;
    const p = createPage({ src: -1, index: 0, pdfPage: null, vp1: null, w, h, origRot: 0 });
    relabel();
    p.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    pushUndo(() => { p.deleted = true; p.wrap.hidden = true; relabel(); });
  }
  async function mergePdf() {
    const f = await pickFile('application/pdf,.pdf');
    if (!f) return;
    try {
      const si = await addSource(new Uint8Array(await f.arrayBuffer()));
      const before = pages.length;
      await addPagesFromSource(si);
      const added = pages.slice(before);
      relabel();
      added[0]?.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pushUndo(() => { added.forEach((p) => { p.deleted = true; p.wrap.hidden = true; }); relabel(); });
      toast(`Added ${added.length} page${added.length === 1 ? '' : 's'} from ${f.name}`);
    } catch (e) {
      alertBox('Couldn’t add that PDF', e.userMessage || e.message);
    }
  }

  // Convert a pointer event to page coordinates (PDF points, top-left origin, before user rotation)
  function toPage(p, e) {
    const r = p.pageEl.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const t = (-p.rot * Math.PI) / 180;
    const x = dx * Math.cos(t) - dy * Math.sin(t);
    const y = dx * Math.sin(t) + dy * Math.cos(t);
    return { x: (x + (p.w * S) / 2) / S, y: (y + (p.h * S) / 2) / S };
  }

  // ---------- existing text (click to edit) ----------
  async function ensureHits(p) {
    if (p.hits || !p.pdfPage || p.loadingHits) return;
    p.loadingHits = true;
    try {
      const tc = await p.pdfPage.getTextContent();
      p.hits = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tx = window.pdfjsLib.Util.transform(p.vp1.transform, it.transform);
        if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01 || tx[0] <= 0) continue; // only straight, upright text
        const fontH = Math.abs(tx[3]);
        if (fontH < 2) continue;
        const st = tc.styles[it.fontName] || {};
        const asc = st.ascent && st.ascent > 0.5 ? st.ascent : 0.85;
        const desc = st.descent && st.descent < 0 ? st.descent : -0.2;
        const fam = /serif/i.test(st.fontFamily || '') && !/sans/i.test(st.fontFamily || '') ? 'serif' : /mono/i.test(st.fontFamily || '') ? 'mono' : 'sans';
        let realName = '';
        try { if (p.pdfPage.commonObjs.has(it.fontName)) realName = p.pdfPage.commonObjs.get(it.fontName)?.name || ''; } catch {}
        const hit = {
          str: it.str, x: tx[4], baseline: tx[5], fontH,
          asc, desc, font: fam, bold: /bold|black|heavy|semibold|demi/i.test(realName),
        };
        hit.w = Math.max(it.width, 4); // pdf.js reports width in page units
        hit.el = el('div', { class: 'hit', title: 'Click to edit this text' });
        hit.el.addEventListener('pointerdown', (e) => { if (tool !== 'text') return; e.stopPropagation(); e.preventDefault(); editExisting(p, hit); });
        p.hits.push(hit);
        positionHit(hit);
        p.overlay.prepend(hit.el);
      }
    } catch (e) {
      console.warn('No text layer', e);
      p.hits = [];
    } finally {
      p.loadingHits = false;
    }
  }
  function positionHit(h) {
    Object.assign(h.el.style, {
      left: h.x * S + 'px', top: (h.baseline - h.fontH * h.asc) * S + 'px',
      width: h.w * S + 'px', height: h.fontH * (h.asc - h.desc) * S + 'px',
    });
  }

  // Read the page image to match background and text colour
  function sampleColors(p, h) {
    const c = p.canvas;
    if (!c.width) return { bg: '#ffffff', fg: style.color };
    try {
      const k = c.width / p.w;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const x0 = Math.max(0, Math.floor(h.x * k)), y0 = Math.max(0, Math.floor((h.baseline - h.fontH * h.asc) * k));
      const w = Math.max(1, Math.min(c.width - x0, Math.ceil(h.w * k))), hh = Math.max(1, Math.min(c.height - y0, Math.ceil(h.fontH * (h.asc - h.desc) * k)));
      const data = ctx.getImageData(x0, y0, w, hh).data;
      // background = most common colour (quantized); text = pixel farthest from it
      const counts = new Map();
      for (let i = 0; i < data.length; i += 16) {
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      let bgKey = 0xfff, best = -1;
      for (const [key, n] of counts) if (n > best) { best = n; bgKey = key; }
      const bg = [((bgKey >> 8) & 15) * 17, ((bgKey >> 4) & 15) * 17, (bgKey & 15) * 17];
      let fg = [17, 17, 17], far = -1;
      for (let i = 0; i < data.length; i += 4) {
        const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
        if (d > far) { far = d; fg = [data[i], data[i + 1], data[i + 2]]; }
      }
      return { bg: toHex(...bg), fg: far > 60 ? toHex(...fg) : '#111111' };
    } catch {
      return { bg: '#ffffff', fg: style.color };
    }
  }

  function editExisting(p, h) {
    const { bg, fg } = sampleColors(p, h);
    const cover = { type: 'rect', x: h.x - 1, y: h.baseline - h.fontH * h.asc - 1, w: h.w + 2, h: h.fontH * (h.asc - h.desc) + 2, fill: bg, opacity: 1 };
    const size = Math.round(h.fontH * 10) / 10;
    const text = { type: 'text', x: h.x, y: h.baseline - size * BASELINE[h.font], text: h.str, size, font: h.font, bold: h.bold, color: fg };
    addItem(p, cover, false);
    addItem(p, text, false);
    h.el.remove();
    pushUndo(() => { removeItem(p, cover, false); removeItem(p, text, false); p.overlay.prepend(h.el); });
    focusText(text, true);
  }

  // ---------- items ----------
  function addItem(p, item, undoable = true) {
    p.items.push(item);
    item.el = buildItemEl(p, item);
    p.overlay.append(item.el);
    positionItem(p, item);
    if (undoable) pushUndo(() => removeItem(p, item, false));
    else markDirty();
    return item;
  }
  function removeItem(p, item, undoable = true) {
    const i = p.items.indexOf(item);
    if (i < 0) return;
    p.items.splice(i, 1);
    item.el.remove();
    if (selected?.item === item) selected = null;
    if (undoable) pushUndo(() => { p.items.splice(i, 0, item); p.overlay.append(item.el); positionItem(p, item); });
  }

  function positionItem(p, it) {
    const s = it.el.style;
    s.left = it.x * S + 'px'; s.top = it.y * S + 'px';
    if (it.type === 'text') {
      s.fontSize = it.size * S + 'px';
      s.fontFamily = FONT_CSS[it.font];
      s.fontWeight = it.bold ? '700' : '400';
      s.color = it.color;
    } else {
      s.width = it.w * S + 'px'; s.height = it.h * S + 'px';
      if (it.type === 'rect') { s.background = it.fill; s.opacity = it.opacity; }
    }
  }

  function selectItem(p, item) {
    if (selected?.item?.el) selected.item.el.classList.remove('sel');
    selected = item ? { page: p, item } : null;
    if (item) {
      item.el.classList.add('sel');
      if (item.type === 'text') {
        Object.assign(style, { font: item.font, size: item.size, bold: item.bold, color: item.color });
        fontSel.value = item.font;
        if (![...sizeSel.options].some((o) => o.value === String(item.size))) sizeSel.append(el('option', { value: String(item.size) }, String(item.size)));
        sizeSel.value = String(item.size);
        boldBtn.classList.toggle('active', item.bold);
        colorPick.input.value = item.color; colorPick.querySelector('.swatch').style.background = item.color;
      }
    }
  }

  function focusText(item, selectAll = false) {
    const tx = item.el.querySelector('.tx');
    tx.focus();
    const range = document.createRange();
    range.selectNodeContents(tx);
    if (!selectAll) range.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
  }

  function buildItemEl(p, it) {
    const node = el('div', { class: `item ${it.type}-item` });
    const del = el('button', { class: 'del', title: 'Remove', 'aria-label': 'Remove' }, '×');
    del.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); removeItem(p, it); });
    if (it.type === 'text') {
      const tx = el('div', { class: 'tx', contenteditable: 'true', spellcheck: 'false' });
      tx.textContent = it.text;
      const grip = el('span', { class: 'grip', title: 'Drag to move' }, '✥');
      node.append(grip, tx, del);
      let before = it.text;
      tx.addEventListener('focus', () => { selectItem(p, it); before = it.text; });
      tx.addEventListener('input', () => { it.text = tx.innerText.replace(/\n$/, ''); markDirty(); });
      tx.addEventListener('blur', () => {
        if (!it.text.trim()) { removeItem(p, it, false); return; }
        if (it.text !== before) { const old = before; pushUndo(() => { it.text = old; tx.textContent = old; }); }
      });
      tx.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
      tx.addEventListener('pointerdown', (e) => e.stopPropagation());
      dragBehavior(p, it, grip, 'move');
      dragBehavior(p, it, node, 'move', (e) => tool === 'select' && e.target === node);
    } else {
      if (it.type === 'image') node.append(el('img', { src: it.src, alt: '', draggable: 'false' }));
      const rs = el('span', { class: 'rs', title: 'Drag to resize' });
      node.append(rs, del);
      dragBehavior(p, it, node, 'move', (e) => e.target !== rs && e.target !== del && (tool === 'select' || it.type === 'image' || selected?.item === it));
      dragBehavior(p, it, rs, 'resize');
    }
    return node;
  }

  function dragBehavior(p, it, handle, mode, when = () => true) {
    handle.addEventListener('pointerdown', (e) => {
      if (!when(e)) return;
      e.stopPropagation(); e.preventDefault();
      selectItem(p, it);
      const start = toPage(p, e);
      const orig = { x: it.x, y: it.y, w: it.w, h: it.h };
      let moved = false;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const pt = toPage(p, ev);
        const dx = pt.x - start.x, dy = pt.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
        if (mode === 'move') { it.x = orig.x + dx; it.y = orig.y + dy; }
        else {
          it.w = Math.max(6, orig.w + dx);
          it.h = it.type === 'image' ? it.w * (orig.h / orig.w) : Math.max(4, orig.h + dy);
        }
        positionItem(p, it);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (moved) pushUndo(() => { Object.assign(it, orig); positionItem(p, it); });
        else if (it.type === 'text' && mode === 'move' && handle === it.el) focusText(it);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // ---------- page interactions ----------
  function wireOverlay(p) {
    p.overlay.addEventListener('pointerdown', (e) => {
      if (e.target !== p.overlay) return;
      const pt = toPage(p, e);
      if (tool === 'select') { selectItem(null); if (document.activeElement?.classList.contains('tx')) document.activeElement.blur(); return; }
      if (tool === 'text') {
        e.preventDefault();
        if (document.activeElement?.classList.contains('tx')) document.activeElement.blur();
        const item = addItem(p, { type: 'text', x: pt.x, y: pt.y - style.size * 0.6, text: '', size: style.size, font: style.font, bold: style.bold, color: style.color }, false);
        pushUndo(() => removeItem(p, item, false));
        focusText(item);
        return;
      }
      if (tool === 'whiteout' || tool === 'highlight') {
        e.preventDefault();
        const draft = el('div', { class: 'draft-rect' });
        p.overlay.append(draft);
        p.overlay.setPointerCapture(e.pointerId);
        let cur = pt;
        const show = () => Object.assign(draft.style, {
          left: Math.min(pt.x, cur.x) * S + 'px', top: Math.min(pt.y, cur.y) * S + 'px',
          width: Math.abs(cur.x - pt.x) * S + 'px', height: Math.abs(cur.y - pt.y) * S + 'px',
        });
        const move = (ev) => { cur = toPage(p, ev); show(); };
        const up = () => {
          p.overlay.removeEventListener('pointermove', move);
          p.overlay.removeEventListener('pointerup', up);
          draft.remove();
          let x = Math.min(pt.x, cur.x), y = Math.min(pt.y, cur.y), w = Math.abs(cur.x - pt.x), h = Math.abs(cur.y - pt.y);
          if (w < 4 || h < 4) { w = tool === 'highlight' ? 120 : 100; h = tool === 'highlight' ? 16 : 24; x = pt.x - w / 2; y = pt.y - h / 2; }
          const item = tool === 'highlight'
            ? { type: 'rect', x, y, w, h, fill: '#ffe94d', opacity: 0.4 }
            : { type: 'rect', x, y, w, h, fill: '#ffffff', opacity: 1 };
          addItem(p, item);
        };
        p.overlay.addEventListener('pointermove', move);
        p.overlay.addEventListener('pointerup', up);
        return;
      }
      if (tool === 'draw') {
        e.preventDefault();
        const stroke = { color: style.pen, width: style.penWidth, pts: [[pt.x, pt.y]] };
        p.strokes.push(stroke);
        p.overlay.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const events = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
          for (const ce of events.length ? events : [ev]) { const q = toPage(p, ce); stroke.pts.push([q.x, q.y]); }
          redrawStrokes(p);
        };
        const up = () => {
          p.overlay.removeEventListener('pointermove', move);
          p.overlay.removeEventListener('pointerup', up);
          redrawStrokes(p);
          pushUndo(() => { const i = p.strokes.indexOf(stroke); if (i >= 0) p.strokes.splice(i, 1); redrawStrokes(p); });
        };
        p.overlay.addEventListener('pointermove', move);
        p.overlay.addEventListener('pointerup', up);
        redrawStrokes(p);
      }
    });
  }

  function currentPage() {
    const wr = workspace.getBoundingClientRect();
    const mid = wr.top + wr.height / 2;
    let best = null, bestD = Infinity;
    for (const p of pages) {
      if (p.deleted) continue;
      const r = p.holder.getBoundingClientRect();
      const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  async function placeImage(src, natW, natH, format, bytes) {
    const p = currentPage();
    if (!p) return;
    const maxW = p.w * 0.4;
    let w = Math.min(maxW, natW * 0.75), h = (w * natH) / natW;
    if (h > p.h * 0.5) { h = p.h * 0.5; w = (h * natW) / natH; }
    // place in the visible middle of the page
    const wr = workspace.getBoundingClientRect();
    const r = p.pageEl.getBoundingClientRect();
    const midY = Math.min(Math.max((wr.top + wr.height / 2 - r.top) / S, h / 2), p.h - h / 2);
    const item = addItem(p, { type: 'image', x: (p.w - w) / 2, y: midY - h / 2, w, h, src, format, bytes });
    setTool('select');
    selectItem(p, item);
  }

  async function addImage() {
    const f = await pickFile('image/png,image/jpeg,image/webp,image/gif');
    if (!f) return;
    const info = await normalizeImage(f);
    const src = await readAsDataURL(new Blob([info.bytes], { type: info.mime }));
    placeImage(src, info.width, info.height, info.format, info.bytes);
  }

  async function addSignature() {
    const result = await modal((close) => {
      const pad = el('canvas', { class: 'sig-pad' });
      let ctx, drawing = false, empty = true, inkColor = '#0b2a8a';
      const setup = () => {
        const r = pad.getBoundingClientRect();
        pad.width = r.width * 2; pad.height = r.height * 2;
        ctx = pad.getContext('2d');
        ctx.scale(2, 2); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = inkColor;
      };
      requestAnimationFrame(setup);
      const pos = (e) => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      pad.addEventListener('pointerdown', (e) => { drawing = true; empty = false; pad.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); ctx.lineTo(...pos(e)); ctx.stroke(); });
      pad.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
      pad.addEventListener('pointerup', () => { drawing = false; });
      const colorBtn = (c, name) => el('button', { class: 'btn', style: { color: c }, onclick: () => { inkColor = c; if (ctx) ctx.strokeStyle = c; } }, name);
      const done = () => {
        if (empty) return toast('Draw your signature first');
        // trim empty space around the signature
        const d = ctx.getImageData(0, 0, pad.width, pad.height).data;
        let x1 = pad.width, y1 = pad.height, x2 = 0, y2 = 0;
        for (let y = 0; y < pad.height; y++) for (let x = 0; x < pad.width; x++) {
          if (d[(y * pad.width + x) * 4 + 3] > 10) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
        }
        const out = document.createElement('canvas');
        out.width = x2 - x1 + 12; out.height = y2 - y1 + 12;
        out.getContext('2d').drawImage(pad, x1 - 6, y1 - 6, out.width, out.height, 0, 0, out.width, out.height);
        close({ url: out.toDataURL('image/png'), w: out.width, h: out.height });
      };
      return el('div', {},
        el('h3', {}, 'Draw your signature'),
        el('p', {}, 'Use your mouse, finger or stylus.'),
        pad,
        el('div', { class: 'row', style: { justifyContent: 'space-between' } },
          el('span', {}, colorBtn('#0b2a8a', 'Blue'), ' ', colorBtn('#111111', 'Black')),
          el('span', { style: { display: 'flex', gap: '8px' } },
            el('button', { class: 'btn', onclick: () => { ctx.clearRect(0, 0, pad.width, pad.height); empty = true; } }, 'Clear'),
            el('button', { class: 'btn primary', onclick: done }, 'Add'))));
    });
    if (!result) return;
    const bytes = Uint8Array.from(atob(result.url.split(',')[1]), (c) => c.charCodeAt(0));
    // signature drawn at 2x; show at a natural size (~180pt wide max)
    placeImage(result.url, result.w / 2, result.h / 2, 'png', bytes);
  }

  function undo() {
    const fn = undoStack.pop();
    if (!fn) return toast('Nothing to undo');
    if (document.activeElement?.classList.contains('tx')) document.activeElement.blur();
    fn();
  }

  const onKey = (e) => {
    const inText = document.activeElement?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inText) { e.preventDefault(); undo(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inText && selected) { e.preventDefault(); removeItem(selected.page, selected.item); }
    if (e.key === 'Escape' && selected) { if (inText) document.activeElement.blur(); selectItem(null); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- save ----------
  function cleanText(font, line) {
    let out = '';
    for (const ch of line.replace(/\t/g, '    ')) {
      try { font.encodeText(ch); out += ch; } catch { out += '?'; unsupportedChars = true; }
    }
    return out;
  }

  async function buildPdf() {
    if (document.activeElement?.classList.contains('tx')) document.activeElement.blur();
    unsupportedChars = false;
    const out = await PDFDocument.load(sources[0].bytes, { updateMetadata: false });
    const libDocs = new Map([[0, out]]);
    const live = pages.filter((p) => !p.deleted);
    const original = out.getPages();
    const unchangedOrder = live.length === original.length && live.every((p, i) => p.src === 0 && p.index === i);
    let target;
    if (unchangedOrder) target = original;
    else {
      const resolved = [];
      for (const p of live) {
        if (p.src === 0) resolved.push(original[p.index]);
        else if (p.src === -1) resolved.push(null);
        else {
          if (!libDocs.has(p.src)) libDocs.set(p.src, await PDFDocument.load(sources[p.src].bytes, { updateMetadata: false }));
          const [copied] = await out.copyPages(libDocs.get(p.src), [p.index]);
          resolved.push(copied);
        }
      }
      for (let i = out.getPageCount() - 1; i >= 0; i--) out.removePage(i);
      target = resolved.map((pg, i) => (pg ? out.addPage(pg) : out.addPage([live[i].w, live[i].h])));
    }

    const fontCache = new Map();
    const getFont = async (fam, bold) => {
      const name = PDF_FONT[fam][bold ? 1 : 0];
      if (!fontCache.has(name)) fontCache.set(name, await out.embedFont(name));
      return fontCache.get(name);
    };
    const imgCache = new Map();

    for (let i = 0; i < live.length; i++) {
      const p = live[i], page = target[i];
      const R = p.origRot;
      const conv = (x, y) => (p.vp1 ? p.vp1.convertToPdfPoint(x, y) : [x, p.h - y]);
      const rot = degrees(R);
      for (const it of p.items) {
        if (it.type === 'rect') {
          const [x, y] = conv(it.x, it.y + it.h);
          page.drawRectangle({ x, y, width: it.w, height: it.h, color: hexToRgb(it.fill), opacity: it.opacity, rotate: rot });
        }
      }
      if (p.strokes.length) {
        for (const s of p.strokes) {
          const path = s.pts.map(([x, y], j) => { const [px, py] = conv(x, y); return `${j ? 'L' : 'M'}${px.toFixed(2)} ${(-py).toFixed(2)}`; }).join(' ')
            + (s.pts.length === 1 ? ` l0.01 0` : '');
          page.drawSvgPath(path, { x: 0, y: 0, borderColor: hexToRgb(s.color), borderWidth: s.width, borderLineCap: LineCapStyle.Round });
        }
      }
      for (const it of p.items) {
        if (it.type === 'image') {
          let emb = imgCache.get(it.bytes);
          if (!emb) { emb = it.format === 'jpg' ? await out.embedJpg(it.bytes) : await out.embedPng(it.bytes); imgCache.set(it.bytes, emb); }
          const [x, y] = conv(it.x, it.y + it.h);
          page.drawImage(emb, { x, y, width: it.w, height: it.h, rotate: rot });
        }
      }
      for (const it of p.items) {
        if (it.type !== 'text' || !it.text.trim()) continue;
        const font = await getFont(it.font, it.bold);
        const lines = it.text.split('\n');
        lines.forEach((line, li) => {
          if (!line) return;
          const baseline = it.y + (li * 1.2 + BASELINE[it.font]) * it.size;
          const [x, y] = conv(it.x, baseline);
          page.drawText(cleanText(font, line), { x, y, size: it.size, font, color: hexToRgb(it.color), rotate: rot });
        });
      }
      if (p.rot) page.setRotation(degrees((R + p.rot) % 360));
    }
    const bytes = await out.save();
    if (unsupportedChars) toast('Some characters (emoji or non-Latin letters) can’t be stored with the built-in PDF fonts and were replaced with “?”.', 6000);
    return bytes;
  }

  async function buildImage(mime) {
    const bytes = await buildPdf();
    const pdf = await window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pdf.destroy();
    return new Promise((r) => c.toBlob(r, mime, 0.92));
  }

  // ---------- start ----------
  const pageInfo = el('span');
  status.append(pageInfo, el('span', { class: 'hide-sm' }, 'Tip: with the Text tool, click any text in the page to change it'));
  await addPagesFromSource(0);
  const maxW = Math.max(...pages.map((p) => p.w));
  setZoom(Math.min(1.5, (workspace.clientWidth - 40) / maxW));
  relabel();
  setTool(tool);
  if (kind === 'image') {
    pages[0].bar.hidden = true;
    // pictures are often large: start with text that is readable relative to the picture
    const size = Math.max(14, Math.round(pages[0].w / 30));
    if (![...sizeSel.options].some((o) => o.value === String(size))) sizeSel.append(el('option', { value: String(size) }, String(size)));
    style.size = size; sizeSel.value = String(size);
  }

  const pdfExport = { label: 'PDF', ext: 'pdf', mime: 'application/pdf', build: async () => new Blob([await buildPdf()], { type: 'application/pdf' }) };
  const pngExport = { label: 'PNG image', ext: 'png', mime: 'image/png', hint: kind === 'image' ? '.png' : 'first page', build: () => buildImage('image/png') };
  const jpgExport = { label: 'JPG image', ext: 'jpg', mime: 'image/jpeg', hint: kind === 'image' ? '.jpg' : 'first page', build: () => buildImage('image/jpeg') };
  let exportsList;
  if (kind === 'image') exportsList = /jpe?g/.test(ext) ? [jpgExport, pngExport, pdfExport] : [pngExport, jpgExport, pdfExport];
  else exportsList = [pdfExport, pngExport, jpgExport];

  return {
    exports: exportsList,
    destroy() {
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
      for (const s of sources) s.pdf.destroy();
    },
  };
}
