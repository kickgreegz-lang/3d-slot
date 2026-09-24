/**
 * Minimal hyperscript for the DOM overlay (no framework): h('div.card', {onclick}, ...children).
 * `tag.class1.class2` shorthand; attrs starting with "on" become listeners; `data-*` /
 * `aria-*` / other attrs are set as attributes; strings become text nodes (never HTML).
 */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export const h = <K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs?: Attrs | null,
  ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K] => {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag as K);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'class') {
        el.className = [el.className, String(v)].filter(Boolean).join(' ');
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
};

const append = (el: Node, children: Array<Child | Child[]>): void => {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
};

/** Inline SVG from trusted, static markup (icons only — never user or server text). */
export const svg = (markup: string, cls = ''): HTMLElement => {
  const wrap = document.createElement('span');
  wrap.className = cls ? `ui-svg ${cls}` : 'ui-svg';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = markup;
  return wrap;
};

export const clear = (el: Element): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};
