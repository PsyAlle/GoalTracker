// dom.js
// A minimal DOM-building helper so the rest of the app isn't full of
// document.createElement calls. No virtual DOM, no diffing — views simply
// clear and rebuild their container on every re-render, which is cheap
// enough for this app's data sizes.

/**
 * @param {string} tag e.g. 'div', 'button.primary', 'span#foo'
 * @param {object} [props] attributes; on* keys become event listeners; `text`/`html` set content
 * @param {Array} [children]
 */
export function el(tag, props = {}, children = []) {
  const [tagName, ...rest] = tag.split(/(?=[.#])/);
  const node = document.createElement(tagName);
  for (const part of rest) {
    if (part.startsWith('.')) node.classList.add(part.slice(1));
    else if (part.startsWith('#')) node.id = part.slice(1);
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      // Note: this REPLACES any classes already added from the tag string
      // (e.g. 'div.stamp' -> classList has 'stamp'). When combining both,
      // include the base class name in the prop value too, e.g.
      // el('div.stamp', { class: isZero ? 'stamp zero' : 'stamp' }).
      node.className = value;
    } else if (key in node && key !== 'list') {
      try {
        node[key] = value;
      } catch {
        node.setAttribute(key, value);
      }
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(container, node) {
  clear(container);
  container.appendChild(node);
}

let toastTimer = null;
export function toast(message) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const node = el('div.toast', { text: message });
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2200);
}

/**
 * Shows a bottom-sheet modal. `contentBuilder(closeFn)` returns the DOM node
 * to render inside the sheet; `closeFn` can be called from inside to dismiss.
 */
export function openModal(contentBuilder) {
  const backdrop = el('div.modal-backdrop');
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  const sheet = el('div.modal-sheet', {}, [contentBuilder(close)]);
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  return close;
}

/** A +/- stepper. onChange(delta) is called with +1 or -1. */
export function stepper(onChange, { disableMinus = false } = {}) {
  return el('div.stepper', {}, [
    el('button.minus', { text: '−', disabled: disableMinus, onClick: () => onChange(-1) }),
    el('button.plus', { text: '+', onClick: () => onChange(1) }),
  ]);
}

/** Renders a "3/5" style progress figure, mono, highlighted green when met. */
export function progressFigure(value, target, unit = '') {
  const met = value >= target;
  return el('span.progress-figure', { class: met ? 'progress-figure met' : 'progress-figure' }, [
    el('span.done.num', { text: String(value) }),
    el('span.slash.num', { text: '/' }),
    el('span.target.num', { text: String(target) + (unit ? ` ${unit}` : '') }),
  ]);
}

/**
 * A simple repeatable "links" editor: array of {label, url} objects, with
 * add/remove controls. Mutates the passed array in place and calls onChange
 * after every mutation so the caller can persist it.
 */
export function linksEditor(links, onChange) {
  const container = el('div.links-list');

  function renderList() {
    clear(container);
    links.forEach((link, i) => {
      container.appendChild(
        el('div.link-item', {}, [
          el('a', { href: link.url, target: '_blank', rel: 'noopener', text: link.label || link.url }),
          el('button', {
            text: 'Ta bort',
            onClick: () => {
              links.splice(i, 1);
              renderList();
              onChange();
            },
          }),
        ])
      );
    });
  }
  renderList();

  const labelInput = el('input', { type: 'text', placeholder: 'Namn (valfritt)' });
  const urlInput = el('input', { type: 'url', placeholder: 'https://…' });
  const addBtn = el('button.btn', {
    text: 'Lägg till länk',
    type: 'button',
    onClick: () => {
      const url = urlInput.value.trim();
      if (!url) return;
      links.push({ label: labelInput.value.trim(), url });
      labelInput.value = '';
      urlInput.value = '';
      renderList();
      onChange();
    },
  });

  return el('div', {}, [
    container,
    el('div.field-row', {}, [el('div.field', {}, [labelInput]), el('div.field', {}, [urlInput])]),
    addBtn,
  ]);
}

export function weekdayPicker(selected, onChange) {
  const labels = { 1: 'M', 2: 'T', 3: 'O', 4: 'T', 5: 'F' };
  const container = el('div.weekday-picker');
  function render() {
    clear(container);
    for (const wd of [1, 2, 3, 4, 5]) {
      const on = selected.includes(wd);
      container.appendChild(
        el('button', {
          type: 'button',
          text: labels[wd],
          class: on ? 'on' : '',
          onClick: () => {
            const idx = selected.indexOf(wd);
            if (idx >= 0) selected.splice(idx, 1);
            else selected.push(wd);
            selected.sort();
            render();
            onChange();
          },
        })
      );
    }
  }
  render();
  return container;
}

// --- SVG progress ring (combined weekly + daily goal completion) ---

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * A circular progress indicator, 0-100. `size: 'small'` renders a compact
 * version meant to sit inline next to a heading (e.g. the period header).
 */
export function progressRing(pct, size = 'normal') {
  const r = 40;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const offset = c - (clamped / 100) * c;

  const svg = svgEl('svg', { class: 'progress-ring', viewBox: '0 0 100 100' });
  svg.appendChild(svgEl('circle', { class: 'ring-track', cx: 50, cy: 50, r }));
  const fill = svgEl('circle', { class: 'ring-fill', cx: 50, cy: 50, r });
  fill.style.strokeDasharray = String(c);
  fill.style.strokeDashoffset = String(offset);
  svg.appendChild(fill);

  return el('div.progress-ring-wrap', { class: size === 'small' ? 'progress-ring-wrap small' : 'progress-ring-wrap' }, [
    svg,
    el('div.ring-label', {}, [el('span.ring-pct.num', { text: Math.round(pct) + '%' })]),
  ]);
}

/**
 * Read-only bottom-sheet showing a goal's name, description, and links.
 * Used from Dashboard so tapping a goal shows its info without opening an
 * edit form — editing only happens from the Mål page.
 */
export function openGoalDetailModal({ name, description, links }) {
  openModal((close) => {
    const children = [
      el('div.modal-close-bar'),
      el('h2', { text: name }),
      el('p.goal-meta', { text: description || 'Ingen beskrivning satt.' }),
    ];
    if (links && links.length) {
      children.push(
        el(
          'div.links-list',
          {},
          links.map((l) => el('div.link-item', {}, [el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label || l.url })]))
        )
      );
    }
    return el('div', {}, children);
  });
}
