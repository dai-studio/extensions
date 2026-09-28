/**
 * bpmn-moddle configured with the dai: descriptor (schema/dai-moddle.json —
 * a verbatim copy of ws-dai-studio/editor-src/src/lib/editor/DaiModdleDescriptor.json).
 */
import { BpmnModdle } from 'bpmn-moddle';
import daiDescriptor from '../../schema/dai-moddle.json' with { type: 'json' };

export const moddle = new BpmnModdle({ dai: daiDescriptor });

/** Native BPMN properties a form field may bind to directly. */
export const NATIVE_KEYS = new Set(['name', 'text']);

export type DeclaredKind = 'native' | 'dai-attr' | 'other' | 'none';

/** How `key` is declared on a business object of `bpmnType`. */
export function declaredKind(bpmnType: string, key: string): DeclaredKind {
  const el = moddle.create(bpmnType);
  const prop = el.$descriptor.propertiesByName[key];
  if (!prop) return 'none';
  if (prop.ns.prefix === 'dai' && prop.isAttr) return 'dai-attr';
  if (prop.ns.prefix === 'bpmn' && NATIVE_KEYS.has(key)) return 'native';
  return 'other';
}
