// Converts the editor's HTML into a real .docx file using the `docx` library.
const D = () => window.docx;

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'MAIN', 'NAV', 'ASIDE']);
const SIZE_KEYWORDS = { 'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24, 'xxx-large': 36 };
const FONT_SIZE_ATTR = [null, 7.5, 10, 12, 13.5, 18, 24, 36];

const ctx2d = document.createElement('canvas').getContext('2d');
function toHex(color) {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c === 'transparent' || c === 'inherit' || c === 'initial' || c === 'currentcolor') return null;
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length === 4 && p[3] === 0) return null;
    return p.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  ctx2d.fillStyle = '#000000';
  ctx2d.fillStyle = c;
  const out = ctx2d.fillStyle;
  if (out.startsWith('#')) return out.slice(1).toUpperCase();
  return toHex(out);
}

function cssSizeToPt(v) {
  if (!v) return null;
  if (SIZE_KEYWORDS[v]) return SIZE_KEYWORDS[v];
  const m = v.match(/^([\d.]+)(px|pt|em|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === 'pt') return n;
  if (m[2] === 'em' || m[2] === 'rem') return n * 12;
  return n * 0.75;
}

function formatFor(node, fmt) {
  const f = { ...fmt };
  const t = node.tagName;
  if (t === 'B' || t === 'STRONG' || t === 'TH') f.bold = true;
  if (t === 'I' || t === 'EM') f.italics = true;
  if (t === 'U' || t === 'INS') f.underline = true;
  if (t === 'S' || t === 'STRIKE' || t === 'DEL') f.strike = true;
  if (t === 'SUP') f.superScript = true;
  if (t === 'SUB') f.subScript = true;
  if (t === 'CODE' || t === 'KBD' || t === 'TT') f.font = 'Courier New';
  if (t === 'FONT') {
    if (node.getAttribute('color')) f.color = toHex(node.getAttribute('color'));
    const s = parseInt(node.getAttribute('size'), 10);
    if (s >= 1 && s <= 7) f.size = FONT_SIZE_ATTR[s];
    if (node.getAttribute('face')) f.font = node.getAttribute('face').split(',')[0].replace(/["']/g, '').trim();
  }
  const st = node.style;
  if (st) {
    if (st.fontWeight === 'bold' || parseInt(st.fontWeight, 10) >= 600) f.bold = true;
    if (st.fontWeight === 'normal') f.bold = false;
    if (st.fontStyle === 'italic') f.italics = true;
    const deco = st.textDecorationLine || st.textDecoration || '';
    if (deco.includes('underline')) f.underline = true;
    if (deco.includes('line-through')) f.strike = true;
    if (st.color) f.color = toHex(st.color) || f.color;
    if (st.backgroundColor) f.shade = toHex(st.backgroundColor) || f.shade;
    if (st.fontSize) f.size = cssSizeToPt(st.fontSize) || f.size;
    if (st.fontFamily) f.font = st.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  }
  return f;
}

function runOptions(f) {
  const d = D();
  const o = {};
  if (f.bold) o.bold = true;
  if (f.italics) o.italics = true;
  if (f.underline) o.underline = {};
  if (f.strike) o.strike = true;
  if (f.superScript) o.superScript = true;
  if (f.subScript) o.subScript = true;
  if (f.color) o.color = f.color;
  if (f.size) o.size = Math.round(f.size * 2);
  if (f.font) o.font = f.font;
  if (f.shade) o.shading = { type: d.ShadingType.CLEAR, color: 'auto', fill: f.shade };
  if (f.link) { o.style = 'Hyperlink'; }
  return o;
}

function dataUrlToBytes(url) {
  const comma = url.indexOf(',');
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(data));
}

// docx only supports png/jpg/gif/bmp: convert anything else (webp, svg) to PNG through a canvas.
async function imageBytes(img) {
  const src = img.getAttribute('src') || '';
  const supported = /^data:image\/(png|jpe?g|gif|bmp)/i.test(src);
  if (supported) return dataUrlToBytes(src);
  if (!img.complete || !img.naturalWidth) await new Promise((r) => { img.onload = img.onerror = r; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function imageRun(img) {
  try {
    const data = await imageBytes(img);
    let w = img.width || img.naturalWidth || 300;
    let h = img.height || img.naturalHeight || 200;
    const max = 600;
    if (w > max) { h = Math.round((h * max) / w); w = max; }
    return new (D().ImageRun)({ data, transformation: { width: w, height: h } });
  } catch (e) {
    console.warn('Skipped image', e);
    return null;
  }
}

async function inlineRuns(nodes, fmt, out, pre = false) {
  const d = D();
  for (const n of nodes) {
    if (n.nodeType === 3) {
      let text = n.textContent;
      if (!pre) text = text.replace(/[ \t\n\r\f]+/g, ' ').replace(/ /g, ' ');
      if (!text) continue;
      if (pre && text.includes('\n')) {
        text.split('\n').forEach((line, i) => out.push(new d.TextRun({ text: line, break: i ? 1 : 0, ...runOptions(fmt) })));
      } else {
        out.push(new d.TextRun({ text, ...runOptions(fmt) }));
      }
    } else if (n.nodeType === 1) {
      const t = n.tagName;
      if (t === 'BR') out.push(new d.TextRun({ text: '', break: 1 }));
      else if (t === 'IMG') { const r = await imageRun(n); if (r) out.push(r); }
      else if (t === 'A' && n.getAttribute('href')) {
        const kids = [];
        await inlineRuns(n.childNodes, { ...formatFor(n, fmt), link: true }, kids, pre);
        const textKids = kids.filter((k) => k instanceof d.TextRun);
        if (textKids.length) out.push(new d.ExternalHyperlink({ link: n.getAttribute('href'), children: textKids }));
      } else if (t === 'STYLE' || t === 'SCRIPT') continue;
      else if (BLOCK.has(t)) {
        // A block inside inline content (rare): treat as line break + content
        out.push(new d.TextRun({ text: '', break: 1 }));
        await inlineRuns(n.childNodes, formatFor(n, fmt), out, pre);
      } else await inlineRuns(n.childNodes, formatFor(n, fmt), out, pre || t === 'PRE');
    }
  }
}

function alignmentOf(node, inherited) {
  const d = D();
  const a = (node?.style?.textAlign || node?.getAttribute?.('align') || '').toLowerCase();
  const map = { center: d.AlignmentType.CENTER, right: d.AlignmentType.RIGHT, justify: d.AlignmentType.JUSTIFIED, left: d.AlignmentType.LEFT, start: d.AlignmentType.LEFT, end: d.AlignmentType.RIGHT };
  return map[a] || inherited;
}

const isBlank = (nodes) => nodes.every((n) => n.nodeType === 3 ? !n.textContent.trim() : n.nodeType !== 1);

class Converter {
  constructor() { this.olInstance = 0; }

  async paragraph(nodes, ctx, blockEl) {
    const d = D();
    const children = [];
    const tag = blockEl?.tagName;
    const pre = tag === 'PRE';
    await inlineRuns(nodes, { ...(blockEl ? formatFor(blockEl, ctx.fmt || {}) : ctx.fmt || {}), ...(pre ? { font: 'Courier New' } : {}) }, children, pre);
    const opts = { children, alignment: alignmentOf(blockEl, ctx.align) };
    const headings = { H1: d.HeadingLevel.HEADING_1, H2: d.HeadingLevel.HEADING_2, H3: d.HeadingLevel.HEADING_3, H4: d.HeadingLevel.HEADING_4, H5: d.HeadingLevel.HEADING_5, H6: d.HeadingLevel.HEADING_6 };
    if (headings[tag]) opts.heading = headings[tag];
    if (ctx.list) {
      if (ctx.list.ordered) opts.numbering = { reference: 'numbers', level: ctx.list.level, instance: ctx.list.instance };
      else opts.numbering = { reference: 'bullets', level: ctx.list.level };
    }
    if (ctx.quote) opts.indent = { left: 720 * ctx.quote };
    if (ctx.cell) opts.spacing = { after: 0 };
    return new d.Paragraph(opts);
  }

  async blocks(container, ctx, out) {
    let pending = [];
    const flush = async () => {
      if (pending.length && !isBlank(pending)) out.push(await this.paragraph(pending, ctx, null));
      pending = [];
    };
    for (const n of container.childNodes) {
      if (n.nodeType === 1 && BLOCK.has(n.tagName)) { await flush(); await this.block(n, ctx, out); }
      else pending.push(n);
    }
    await flush();
  }

  async block(node, ctx, out) {
    const d = D();
    const t = node.tagName;
    if (t === 'HR') {
      out.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } } }));
      return;
    }
    if (t === 'UL' || t === 'OL') {
      const level = ctx.list ? Math.min(ctx.list.level + 1, 8) : 0;
      const ordered = t === 'OL';
      const instance = ordered ? ++this.olInstance : 0;
      for (const li of node.children) {
        if (li.tagName !== 'LI') { await this.block(li, ctx, out); continue; }
        const listCtx = { ...ctx, list: { ordered, level, instance } };
        // inline part of the item becomes the numbered paragraph; nested lists recurse
        let inline = [];
        let first = true;
        const flushItem = async () => {
          if (inline.length && !isBlank(inline)) {
            out.push(await this.paragraph(inline, first ? listCtx : { ...listCtx, list: null, quote: (ctx.quote || 0) + level + 1 }, li));
            first = false;
          }
          inline = [];
        };
        for (const c of li.childNodes) {
          if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) { await flushItem(); await this.block(c, listCtx, out); }
          else if (c.nodeType === 1 && (c.tagName === 'P' || c.tagName === 'DIV')) { inline.push(...c.childNodes); }
          else inline.push(c);
        }
        if (first && isBlank(inline)) inline = [document.createTextNode('')];
        await flushItem();
      }
      return;
    }
    if (t === 'TABLE') {
      const rows = [...node.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')];
      const cols = Math.max(1, ...rows.map((r) => [...r.children].reduce((s, c) => s + (parseInt(c.getAttribute('colspan'), 10) || 1), 0)));
      const tableRows = [];
      for (const r of rows) {
        const cells = [];
        for (const c of r.children) {
          if (c.tagName !== 'TD' && c.tagName !== 'TH') continue;
          const paras = [];
          await this.blocks(c, { ...ctx, list: null, cell: true, fmt: c.tagName === 'TH' ? { bold: true } : ctx.fmt }, paras);
          if (!paras.length) paras.push(new d.Paragraph(''));
          const opts = { children: paras };
          const span = parseInt(c.getAttribute('colspan'), 10);
          if (span > 1) opts.columnSpan = span;
          const bg = toHex(c.style.backgroundColor);
          if (bg) opts.shading = { type: d.ShadingType.CLEAR, color: 'auto', fill: bg };
          cells.push(new d.TableCell(opts));
        }
        if (cells.length) tableRows.push(new d.TableRow({ children: cells }));
      }
      if (tableRows.length) {
        out.push(new d.Table({ rows: tableRows, width: { size: 100, type: d.WidthType.PERCENTAGE }, columnWidths: Array(cols).fill(Math.floor(9000 / cols)) }));
        out.push(new d.Paragraph(''));
      }
      return;
    }
    const childCtx = { ...ctx, align: alignmentOf(node, ctx.align) };
    if (t === 'BLOCKQUOTE') childCtx.quote = (ctx.quote || 0) + 1;
    const hasBlockKids = [...node.children].some((c) => BLOCK.has(c.tagName));
    if (hasBlockKids || t === 'BLOCKQUOTE' && hasBlockKids) await this.blocks(node, { ...childCtx, fmt: formatFor(node, ctx.fmt || {}) }, out);
    else out.push(await this.paragraph(node.childNodes, childCtx, node));
  }
}

function listLevels(ordered) {
  const d = D();
  const bullets = ['•', '◦', '▪'];
  const formats = [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN];
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: ordered ? formats[level % 3] : d.LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : bullets[level % 3],
    alignment: d.AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
}

export async function htmlToDocxBlob(root, title = 'Document') {
  const d = D();
  const conv = new Converter();
  const children = [];
  await conv.blocks(root, {}, children);
  if (!children.length) children.push(new d.Paragraph(''));
  const doc = new d.Document({
    title,
    creator: 'EasyDocs',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: { config: [{ reference: 'bullets', levels: listLevels(false) }, { reference: 'numbers', levels: listLevels(true) }] },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  return d.Packer.toBlob(doc);
}
