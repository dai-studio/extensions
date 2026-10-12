/**
 * Strict SVG allowlist check for `quickicon` (rendered with {@html} in the
 * editor). CI rejects anything outside the allowlist; the editor additionally
 * re-sanitises with the same allowlist before rendering.
 *
 * `checkSvg(svg, EXAMPLE_ALLOWLIST)` checks SVG field `example`s against the
 * wider example allowlist (text, gradients, fragment-only `href`, …).
 */
import { Parser } from 'saxen';
import iconAllowlist from '../../schema/svg-allowlist.json' with { type: 'json' };
import exampleAllowlist from '../../schema/svg-example-allowlist.json' with { type: 'json' };

export interface SvgAllowlist {
  maxBytes: number;
  elements: string[];
  attributes: string[];
  xmlnsValue: string;
  forbiddenValuePatterns: string[];
  /** Attributes whose value must be a same-document fragment (`#id`). */
  fragmentOnlyAttributes?: string[];
}

/** Elements whose text content is allowed (when the allowlist includes them). */
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'title', 'desc']);

export const ICON_ALLOWLIST: SvgAllowlist = iconAllowlist;
export const EXAMPLE_ALLOWLIST: SvgAllowlist = exampleAllowlist;

export function checkSvg(svg: string, allowlist: SvgAllowlist = ICON_ALLOWLIST): string[] {
  const elements = new Set(allowlist.elements);
  const attributes = new Set(allowlist.attributes);
  const forbidden = allowlist.forbiddenValuePatterns.map(p => new RegExp(p, 'i'));
  const fragmentOnly = new Set(allowlist.fragmentOnlyAttributes ?? []);

  const errors: string[] = [];
  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > allowlist.maxBytes) errors.push(`SVG is ${bytes} bytes (max ${allowlist.maxBytes})`);
  if (!svg.trimStart().startsWith('<svg')) errors.push('SVG must start with <svg');

  let depth = 0;
  let roots = 0;
  const stack: string[] = [];
  const parser = new Parser();

  // saxen fires closeTag for self-closing tags too, so depth is balanced by
  // incrementing on every openTag.
  parser.on('openTag', (name: string, getAttrs: () => Record<string, string>) => {
    if (depth === 0) {
      roots++;
      if (name !== 'svg') errors.push(`root element must be <svg>, got <${name}>`);
    }
    if (!elements.has(name)) errors.push(`element <${name}> is not allowed`);
    const attrs = getAttrs();
    for (const [attr, value] of Object.entries(attrs)) {
      if (!attributes.has(attr)) {
        errors.push(`attribute "${attr}" on <${name}> is not allowed`);
        continue;
      }
      if (attr === 'xmlns' && value !== allowlist.xmlnsValue) {
        errors.push(`xmlns must be ${allowlist.xmlnsValue}`);
      }
      if (fragmentOnly.has(attr) && !/^#[A-Za-z][\w.-]*$/.test(value)) {
        errors.push(`attribute "${attr}" on <${name}> must be a #fragment`);
      }
      for (const re of forbidden) {
        if (re.test(value)) errors.push(`attribute "${attr}" on <${name}> has a forbidden value`);
      }
    }
    stack.push(name);
    depth++;
  });
  parser.on('closeTag', () => { depth--; stack.pop(); });
  parser.on('text', (text: string) => {
    if (!text.trim()) return;
    const parent = stack[stack.length - 1];
    // Only text-bearing elements may hold text, and only if the allowlist has them.
    if (!(parent && TEXT_ELEMENTS.has(parent) && elements.has(parent))) {
      errors.push('text content is not allowed in SVG');
    }
  });
  parser.on('cdata', () => { errors.push('CDATA is not allowed in SVG'); });
  parser.on('comment', () => { errors.push('comments are not allowed in SVG'); });
  parser.on('question', () => { errors.push('processing instructions are not allowed in SVG'); });
  parser.on('attention', () => { errors.push('DOCTYPE / declarations are not allowed in SVG'); });
  parser.on('error', (err: Error) => { errors.push(`malformed SVG: ${err.message}`); });
  parser.on('warn', (err: Error) => { errors.push(`malformed SVG: ${err.message}`); });

  try {
    parser.parse(svg);
  } catch (err) {
    errors.push(`malformed SVG: ${(err as Error).message}`);
  }
  if (roots !== 1) errors.push(`SVG must have exactly one root element (found ${roots})`);
  if (depth !== 0) errors.push('SVG has unclosed elements');
  return [...new Set(errors)];
}
