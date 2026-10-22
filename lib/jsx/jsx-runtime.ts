/**
 * Mini moteur JSX → chaîne HTML (aucun React côté vitrine) : les pages sont du HTML pur,
 * sans hydratation, pour cohabiter avec le JavaScript existant (panier, filtres, favoris).
 */
export class Html { constructor(public html: string) {} toString() { return this.html; } }
export type Child = Html | string | number | boolean | null | undefined | Child[];

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ATTR: Record<string, string> = { className: 'class', htmlFor: 'for', defaultValue: 'value', defaultChecked: 'checked', tabIndex: 'tabindex', crossOrigin: 'crossorigin', fetchPriority: 'fetchpriority',
  enterKeyHint: 'enterkeyhint', inputMode: 'inputmode', autoComplete: 'autocomplete', autoCapitalize: 'autocapitalize', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule', clipRule: 'clip-rule' };
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kebab = (s: string) => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

export function renderChild(c: Child): string {
  if (c === null || c === undefined || c === false || c === true) return '';
  if (c instanceof Html) return c.html;
  if (Array.isArray(c)) return c.map(renderChild).join('');
  return esc(c);
}

export function jsx(type: unknown, props: Record<string, any> | null, _key?: unknown): Html {
  props = props ?? {};
  if (typeof type === 'function') { const r = (type as (p: any) => Child)(props); return r instanceof Html ? r : new Html(renderChild(r)); }
  if (type === Fragment) return new Html(renderChild(props.children));
  const tag = String(type); let attrs = '';
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children' || k === 'dangerouslySetInnerHTML' || v === undefined || v === null || v === false) continue;
    const name = ATTR[k] ?? k;
    if (k === 'style' && typeof v === 'object') { attrs += ` style="${esc(Object.entries(v).map(([a, b]) => `${kebab(a)}:${typeof b === 'number' && !/^(opacity|zIndex|flex|fontWeight|lineHeight)$/.test(a) ? b + 'px' : b}`).join(';'))}"`; continue; }
    attrs += v === true ? ` ${name}` : ` ${name}="${esc(v)}"`;
  }
  if (VOID.has(tag)) return new Html(`<${tag}${attrs}>`);
  const inner = props.dangerouslySetInnerHTML ? String(props.dangerouslySetInnerHTML.__html ?? '') : renderChild(props.children);
  return new Html(`<${tag}${attrs}>${inner}</${tag}>`);
}
export const jsxs = jsx;
export const Fragment = Symbol('Fragment');

export declare namespace JSX {
  type Element = Html;
  interface ElementChildrenAttribute { children: unknown }
  interface IntrinsicAttributes { key?: string | number }
  interface IntrinsicElements { [tag: string]: any }
}
