/**
 * Catalog model + construction from a loaded repo.
 *
 * The output shape is consumed by ws-dai-studio (editor-src/src/lib/types/
 * TypeDefinition.ts + catalog loader). Changing field names here is a
 * breaking change for the editor.
 */
import { declaredKind } from './moddle.ts';
import type { Repo } from './repo.ts';

export type FieldStorage = 'native' | 'attr' | 'field' | 'properties';

export interface CatalogField {
  key: string;
  label: string;
  type: string;
  storage: FieldStorage;
  [k: string]: unknown;
}

export interface CatalogType {
  id: string;
  category: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  colors: { fill: string; stroke: string };
  bpmnType: string;
  license: 'free';
  form: CatalogField[];
  stepType?: string;
  eventDefinitionType?: string;
  aliases?: string[];
  deprecated?: boolean;
  replacedBy?: string;
  kid?: string;
  signature?: string;
  [k: string]: unknown;
}

export interface CatalogPattern {
  id: string;
  category: string;
  name: string;
  description: string;
  version: string;
  sha256: string;
  aliases?: string[];
  deprecated?: boolean;
}

export interface Catalog {
  format: 1;
  build: string;
  publishedAt: string;
  categories: {
    types: Record<string, Record<string, unknown>>;
    patterns: Record<string, Record<string, unknown>>;
  };
  types: CatalogType[];
  patterns: CatalogPattern[];
  kid?: string;
  signature?: string;
}

/**
 * Storage inferred when a field doesn't declare one:
 *   key-value                     -> properties  (dai:Properties extension element)
 *   native BPMN name/text         -> native
 *   dai: attribute declared for   -> attr        (existing descriptor attribute)
 *   that bpmnType
 *   anything else                 -> field       (<dai:fields><dai:field key>)
 * Returns null when the key collides with some other declared property.
 */
export function inferStorage(bpmnType: string, key: string, fieldType: string): FieldStorage | null {
  if (fieldType === 'key-value') return 'properties';
  switch (declaredKind(bpmnType, key)) {
    case 'native': return 'native';
    case 'dai-attr': return 'attr';
    case 'none': return 'field';
    default: return null;
  }
}

export function buildType(t: Repo['types'][number]): CatalogType {
  const data = t.data as Record<string, any>;
  const form = (Array.isArray(data.form) ? data.form : []).map((f: Record<string, any>) => ({
    ...f,
    storage: (f.storage ?? inferStorage(data.bpmnType, f.key, f.type) ?? 'field') as FieldStorage,
  }));
  return { ...data, id: t.id, category: t.category, form } as CatalogType;
}

export function buildCatalog(repo: Repo, patternShas: Record<string, string>, build: string): Catalog {
  const types = repo.types.map(buildType).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const patterns: CatalogPattern[] = repo.patterns
    .map(p => ({ ...(p.data as object), id: p.id, category: p.category, sha256: patternShas[p.id] } as CatalogPattern))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const categories = {
    types: Object.fromEntries(Object.entries(repo.typeCategories).map(([k, v]) => [k, v.data])),
    patterns: Object.fromEntries(Object.entries(repo.patternCategories).map(([k, v]) => [k, v.data])),
  };
  return { format: 1, build, publishedAt: new Date().toISOString(), categories, types, patterns };
}
