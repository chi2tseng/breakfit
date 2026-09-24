'use strict';
// In-page layout lint for the selftest size matrix (`npm.cmd run selftest -- --matrix`).
// `lint` is serialised with toString() and run inside the renderer, so it must not use any
// closure variables. Rules (DESIGN.md §10):
//   a overflow-x   content wider than its box (scrollWidth > clientWidth + 1), except [data-lint-scroll]
//   b outside      border box outside its nearest card / panel / dialog, or outside the window
//   c truncated    text cut by an ellipsis, or clipped by overflow hidden / an overlay scroller
//   d wrap         a short label (≤ 8 chars), button, segment, chip, pill or heading on > 1 line
//   e align        rows of one list / table whose control columns differ by > 1 px
//   f type         font-size / line-height / weight not a DESIGN.md token, or < 13 px
//   g target       interactive element smaller than the HIG minimum (DESIGN.md §8)
//   f also checks tracking: letter-spacing must match the size's DESIGN.md §1.1 value
//   h role         comparable elements (opts.roles: row labels, table headers, card titles …)
//                  rendering with more than one size / line-height / weight / tracking combo

function lint(opts) {
  const kind = opts.kind; // 'main' | 'overlay'
  const root = document.querySelector(opts.root || 'body') || document.body;
  const issues = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const scale = kind === 'overlay' ? rem / 16 : 1; // overlay tokens are rem (16 px base)
  const r1 = (n) => Math.round(n * 10) / 10;

  const sel = (el) => {
    const part = (e) => {
      if (!e || e === document.body) return 'body';
      let s = e.tagName.toLowerCase();
      if (e.id) return `${s}#${e.id}`;
      const cls = [...e.classList].filter((c) => !['on', 'active', 'done', 'next', 'has', 'sel', 'today'].includes(c)).slice(0, 2);
      if (cls.length) s += `.${cls.join('.')}`;
      return s;
    };
    const out = [];
    let e = el;
    for (let i = 0; i < 3 && e && e !== document.documentElement; i++) {
      out.unshift(part(e));
      if (e.id) break;
      e = e.parentElement;
    }
    return out.join(' > ');
  };
  const text = (el) => ((el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ')).slice(0, 40);
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const size = (r) => `${r1(r.width)}×${r1(r.height)}`;
  const add = (rule, el, msg, extra = {}) => {
    const r = el.getBoundingClientRect();
    issues.push({ rule, sel: sel(el), text: text(el), size: size(r), msg, ...extra });
  };
  const isIcon = (el) => el.classList && el.classList.contains('ms');

  const all = [root, ...root.querySelectorAll('*')].filter((el) => !(el.closest('svg') && el.tagName.toLowerCase() !== 'text') && visible(el));
  const CONTAINERS = opts.containers || '.card, .panel, .player-card, .modal-card, .lib-card, #panel, #side, #top';
  const allSet = new Set(all);
  const clipsOverflow = (cs) => cs.overflowX !== 'visible' || cs.overflowY !== 'visible';

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (['svg', 'text', 'video', 'input', 'textarea', 'select'].includes(tag) || isIcon(el)) continue;
    const cs = getComputedStyle(el);
    const hasText = !!text(el);

    // (a) horizontal overflow
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !el.closest('[data-lint-scroll]') && cs.textOverflow !== 'ellipsis') {
      add('a-overflow-x', el, `content ${el.scrollWidth}px > box ${el.clientWidth}px`);
    }
    // (c) truncation / clipping
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
      add('c-truncated', el, `ellipsis: ${el.scrollWidth}px text in ${el.clientWidth}px`);
    } else if (hasText && el.clientWidth > 0) {
      const hid = (v) => v === 'hidden' || v === 'clip';
      const overlayScroller = kind === 'overlay' && (cs.overflowY === 'auto' || cs.overflowY === 'scroll');
      if ((hid(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)
        || ((hid(cs.overflowY) || overlayScroller) && el.scrollHeight > el.clientHeight + 1)) {
        add('c-truncated', el, `clipped: content ${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}`);
      }
    }
  }

  // (b) outside the nearest container / the window
  for (const el of all) {
    if (el === root || isIcon(el) || el.tagName.toLowerCase() === 'text') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') continue;
    if (r.left < -1 || r.right > vw + 1 || (kind === 'overlay' && r.bottom > vh + 1)) {
      add('b-outside', el, `outside window ${vw}×${vh}: [${r1(r.left)}, ${r1(r.top)}, ${r1(r.right)}, ${r1(r.bottom)}]`);
      continue;
    }
    const box = el.parentElement && el.parentElement.closest(CONTAINERS);
    if (!box) continue;
    // anything clipped / scrolled between the element and its container is rule (c)'s business
    let e = el.parentElement;
    let clipped = false;
    while (e && e !== box) {
      if (clipsOverflow(getComputedStyle(e))) { clipped = true; break; }
      e = e.parentElement;
    }
    if (clipped) continue;
    const b = box.getBoundingClientRect();
    const d = [b.left - r.left, r.right - b.right, b.top - r.top, r.bottom - b.bottom];
    if (Math.max(...d) > 1) add('b-outside', el, `sticks out of ${sel(box)} by ${r1(Math.max(...d))}px`);
  }

  // (d) wrapping labels + (f) type tokens, from every visible text node
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const combos = {};
  const seen = new Set();
  const typeEls = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    const p = n.parentElement;
    if (!t || !p || !allSet.has(p) || isIcon(p) || p.closest('.ms')) continue;
    if (!seen.has(p)) { seen.add(p); typeEls.push(p); }
    if (p.closest('svg')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const tops = [];
    for (const rc of range.getClientRects()) {
      if (rc.width < 1 || rc.height < 1) continue;
      const mid = rc.top + rc.height / 2;
      if (!tops.some((m) => Math.abs(m - mid) < rc.height / 2)) tops.push(mid);
    }
    let labelish = p.closest('button, .btn, .seg, .chip, .pill, label, h1, h2, h3, h4, .lbl, .k, .mode-tag, .nm, .eyebrow, [role="button"]');
    // a library card is a role=button tile: its caption is a name that may wrap (long English names), not a button label
    if (labelish && labelish.classList.contains('lib-card') && p.closest('.lib-card .n')) labelish = null;
    if (tops.length > 1 && ([...t].length <= 8 || labelish)) {
      add('d-wrap', p, `"${t.slice(0, 20)}" on ${tops.length} lines`);
    }
  }
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) && el.type !== 'range' && !seen.has(el)) { seen.add(el); typeEls.push(el); }
  }
  const TOK = opts.tokens || [];
  for (const el of typeEls) {
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const fs = px / scale;
    const isSvg = !!el.closest('svg');
    const lh = isSvg ? null : cs.lineHeight === 'normal' ? 'normal' : parseFloat(cs.lineHeight) / scale;
    const w = Number(cs.fontWeight);
    const key = `${r1(fs)}/${lh == null ? '-' : lh === 'normal' ? 'normal' : r1(lh)}/${w}`;
    const tok = TOK.find((k) => Math.abs(k.size - fs) < 0.3 && (lh == null || (lh !== 'normal' && Math.abs(k.lh - lh) < 0.6)) && k.weights.includes(w));
    const c = combos[key] || (combos[key] = { count: 0, token: tok ? tok.name : null, eg: [] });
    c.count++;
    if (c.eg.length < 3) c.eg.push(`${sel(el)} "${text(el).slice(0, 12)}"`);
    if (!tok) add('f-type', el, `${key} is not a type token`);
    else if (px < 12.95) add('f-type', el, `${r1(px)}px rendered (< 13 px minimum)`);
    else if (!isSvg || cs.letterSpacing !== 'normal') {
      // DESIGN.md §1.1 tracking: 13 → 0, 15 → −0.016em, 17 → −0.02em, ≥ 21 → −0.015em
      const em = fs < 14 ? 0 : fs < 16 ? -0.016 : fs < 19 ? -0.02 : -0.015;
      const ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing);
      if (Math.abs(ls - em * px) > 0.06) add('f-type', el, `letter-spacing ${r1(ls * 100) / 100}px, token wants ${r1(em * px * 100) / 100}px`);
    }
  }

  // (h) one role, one rendering: comparable elements must share a single token + tracking
  for (const [role, rs] of Object.entries(opts.roles || {})) {
    const found = {};
    for (const el of root.querySelectorAll(rs)) {
      if (!allSet.has(el)) continue;
      const cs = getComputedStyle(el);
      const k = `${r1(parseFloat(cs.fontSize) / scale)}/${cs.lineHeight === 'normal' ? 'normal' : r1(parseFloat(cs.lineHeight) / scale)}/${cs.fontWeight}/${cs.letterSpacing}`;
      (found[k] || (found[k] = [])).push(el);
    }
    const ks = Object.keys(found);
    if (ks.length > 1) add('h-role', found[ks[1]][0], `${role} renders ${ks.length} ways: ${ks.map((k) => `${k} ×${found[k].length}`).join(', ')}`);
  }

  // (e) column alignment inside lists / tables
  for (const g of opts.groups || []) {
    for (const scope of document.querySelectorAll(g.scope)) {
      if (!visible(scope)) continue;
      const rows = [...scope.querySelectorAll(g.row)].filter(visible);
      if (rows.length < 2) continue;
      for (const [cs, edge] of g.cols) {
        const vals = rows.map((r) => {
          const c = r.querySelector(cs);
          if (!c || !visible(c)) return null;
          const rc = c.getBoundingClientRect();
          return edge === 'center' ? (rc.left + rc.right) / 2 : rc[edge];
        }).filter((v) => v != null);
        if (vals.length < 2) continue;
        const spread = Math.max(...vals) - Math.min(...vals);
        if (spread > 1) add('e-align', scope, `${g.row} ${cs} ${edge} edges differ by ${r1(spread)}px`);
      }
    }
  }

  // (g) hit targets
  const targets = all.filter((el) => el.matches('button, input, select, textarea, [role="button"], a[href]'));
  for (const el of targets) {
    const r = el.getBoundingClientRect();
    let minW = 28;
    let minH = 28;
    if (kind === 'overlay') { minW = 44; minH = 44; } else if (el.classList.contains('btn')) { minH = 44; }
    if (r.width + 0.5 < minW || r.height + 0.5 < minH) add('g-target', el, `${size(r)} < ${minW}×${minH}`);
  }

  return { issues, combos, viewport: `${vw}×${vh}`, rem };
}

module.exports = { lintSource: `(${lint.toString()})` };
