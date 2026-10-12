/**
 * Checks for embed field `example`s (html / css / svg).
 *
 * The editor renders embed previews inside `<iframe sandbox="">` (no scripts,
 * opaque origin) with a `default-src 'none'` CSP, so these checks are defence
 * in depth: catalog examples must be self-contained, script-free and never
 * reach the network.
 */
import { checkSvg, EXAMPLE_ALLOWLIST } from './svg.ts';

/** Field types that may carry an `example`. */
export const EXAMPLE_FIELD_TYPES = new Set(['html', 'css', 'svg', 'code', 'markdown']);

/** Max total `example` bytes per type. */
export const MAX_TYPE_EXAMPLE_BYTES = 48 * 1024;

const FORBIDDEN_TAGS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'portal'];

/** A URL value that leaves the document: any scheme (`https:`, `data:`, …) or protocol-relative `//`. */
const EXTERNAL_URL = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function checkCss(css: string): string[] {
  const errors: string[] = [];
  if (/@import/i.test(css)) errors.push('@import is not allowed');
  if (/@font-face/i.test(css) && /src\s*:/i.test(css)) errors.push('@font-face src is not allowed (no external fonts)');
  for (const m of css.matchAll(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (!m[2].startsWith('#')) errors.push(`url(${m[2].slice(0, 40)}) is not allowed (only url(#fragment))`);
  }
  if (/expression\s*\(/i.test(css)) errors.push('expression() is not allowed');
  // IE `behavior:` (HTC) — not `scroll-behavior:` / `overscroll-behavior:`.
  if (/(^|[^\w-])behavior\s*:/i.test(css)) errors.push('behavior: is not allowed');
  if (/-moz-binding/i.test(css)) errors.push('-moz-binding is not allowed');
  if (/javascript:/i.test(css)) errors.push('javascript: is not allowed');
  if (/<\//.test(css)) errors.push('"</" is not allowed in CSS');
  return [...new Set(errors)];
}

export function checkHtml(html: string): string[] {
  const errors: string[] = [];
  for (const tag of FORBIDDEN_TAGS) {
    if (new RegExp(`<\\s*${tag}\\b`, 'i').test(html)) errors.push(`<${tag}> is not allowed`);
  }
  if (/<!--/.test(html)) errors.push('HTML comments are not allowed');

  // Attributes inside tags.
  for (const tag of html.matchAll(/<\s*[a-z][\w-]*\b([^>]*)>/gi)) {
    const attrs = tag[1];
    for (const a of attrs.matchAll(/([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (name.startsWith('on')) errors.push(`event handler attribute "${name}" is not allowed`);
      else if (name === 'srcdoc') errors.push('srcdoc is not allowed');
      else if (name === 'action' || name === 'formaction') errors.push(`"${name}" is not allowed`);
      else if (['src', 'href', 'srcset', 'poster', 'xlink:href', 'background', 'ping', 'cite', 'data'].includes(name)) {
        if (EXTERNAL_URL.test(value)) errors.push(`${name}="${value.slice(0, 40)}" is not allowed (no external or scheme URLs)`);
      } else if (name === 'style') {
        for (const e of checkCss(value)) errors.push(`style attribute: ${e}`);
      }
      if (/javascript:|vbscript:/i.test(value)) errors.push(`attribute "${name}" has a forbidden value`);
    }
  }
  // Inline <style> blocks.
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    for (const e of checkCss(m[1])) errors.push(`<style>: ${e}`);
  }
  // Inline <svg> islands use the SVG example rules for urls; the attribute
  // checks above already cover handlers and external references.
  return [...new Set(errors)];
}

/** Check one field `example` for its field type. */
export function checkExample(fieldType: string, example: string): string[] {
  switch (fieldType) {
    case 'html': return checkHtml(example);
    case 'css': return checkCss(example);
    case 'svg': return checkSvg(example, EXAMPLE_ALLOWLIST);
    default: return [];
  }
}
