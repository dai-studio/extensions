/**
 * Strict SVG allowlist check for `quickicon` (rendered with {@html} in the
 * editor). CI rejects anything outside the allowlist; the editor additionally
 * re-sanitises with the same allowlist before rendering.
 */
import { Parser } from 'saxen';
import allowlist from '../../schema/svg-allowlist.json' with { type: 'json' };

const ELEMENTS = new Set(allowlist.elements);
const ATTRIBUTES = new Set(allowlist.attributes);
const FORBIDDEN = allowlist.forbiddenValuePatterns.map(p => new RegExp(p, 'i'));

export function checkSvg(svg: string): string[] {
  const errors: string[] = [];
  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > allowlist.maxBytes) errors.push(`SVG is ${bytes} bytes (max ${allowlist.maxBytes})`);
  if (!svg.trimStart().startsWith('<svg')) errors.push('SVG must start with <svg');

  let depth = 0;
  let roots = 0;
  const parser = new Parser();

  // saxen fires closeTag for self-closing tags too, so depth is balanced by
  // incrementing on every openTag.
  parser.on('openTag', (name: string, getAttrs: () => Record<string, string>) => {
    if (depth === 0) {
      roots++;
      if (name !== 'svg') errors.push(`root element must be <svg>, got <${name}>`);
    }
    if (!ELEMENTS.has(name)) errors.push(`element <${name}> is not allowed`);
    const attrs = getAttrs();
    for (const [attr, value] of Object.entries(attrs)) {
      if (!ATTRIBUTES.has(attr)) {
        errors.push(`attribute "${attr}" on <${name}> is not allowed`);
        continue;
      }
      if (attr === 'xmlns' && value !== allowlist.xmlnsValue) {
        errors.push(`xmlns must be ${allowlist.xmlnsValue}`);
      }
      for (const re of FORBIDDEN) {
        if (re.test(value)) errors.push(`attribute "${attr}" on <${name}> has a forbidden value`);
      }
    }
    depth++;
  });
  parser.on('closeTag', () => { depth--; });
  parser.on('text', (text: string) => {
    if (text.trim()) errors.push('text content is not allowed in SVG');
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
