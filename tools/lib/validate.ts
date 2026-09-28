/**
 * All contribution checks. Returns a flat list of human-readable errors;
 * an empty list means the repo is publishable.
 */
import { Ajv } from 'ajv';
import typeSchema from '../../schema/type.schema.json' with { type: 'json' };
import typeCategorySchema from '../../schema/type-category.schema.json' with { type: 'json' };
import patternSchema from '../../schema/pattern.schema.json' with { type: 'json' };
import patternCategorySchema from '../../schema/pattern-category.schema.json' with { type: 'json' };
import { checkSvg } from './svg.ts';
import { declaredKind, moddle } from './moddle.ts';
import { buildType, inferStorage, type CatalogType } from './catalog.ts';
import { rel, type Repo } from './repo.ts';

const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const validateTypeSchema = ajv.compile(typeSchema);
const validateTypeCategorySchema = ajv.compile(typeCategorySchema);
const validatePatternSchema = ajv.compile(patternSchema);
const validatePatternCategorySchema = ajv.compile(patternCategorySchema);

const TASKLIKE = new Set(['bpmn:Task', 'bpmn:SubProcess']);
const EVENTS = new Set(['bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent']);

function schemaErrors(file: string, fn: ReturnType<typeof ajv.compile>, data: unknown): string[] {
  if (fn(data)) return [];
  return (fn.errors ?? []).map(e => {
    const extra = e.keyword === 'additionalProperties' ? ` (${(e.params as any).additionalProperty})` : '';
    return `${rel(file)}: ${e.instancePath || '/'} ${e.message}${extra}`;
  });
}

function findNulls(value: unknown, at = ''): string[] {
  if (value === null) return [at || '/'];
  if (Array.isArray(value)) return value.flatMap((v, i) => findNulls(v, `${at}/${i}`));
  if (typeof value === 'object') return Object.entries(value as object).flatMap(([k, v]) => findNulls(v, `${at}/${k}`));
  return [];
}

export function validateRepo(repo: Repo): { errors: string[]; types: CatalogType[] } {
  const errors = [...repo.errors];

  // ── categories ─────────────────────────────────────────────────────────────
  for (const [, cat] of Object.entries(repo.typeCategories)) {
    errors.push(...schemaErrors(cat.file, validateTypeCategorySchema, cat.data));
  }
  for (const [, cat] of Object.entries(repo.patternCategories)) {
    errors.push(...schemaErrors(cat.file, validatePatternCategorySchema, cat.data));
  }

  // ── types: schema + per-type semantics ────────────────────────────────────
  const validTypes: CatalogType[] = [];
  for (const t of repo.types) {
    const f = rel(t.file);
    for (const p of findNulls(t.data)) errors.push(`${f}: null value at ${p} (remove the key instead)`);
    const schemaErrs = schemaErrors(t.file, validateTypeSchema, t.data);
    errors.push(...schemaErrs);
    if (schemaErrs.length) continue;

    const d = t.data as Record<string, any>;
    const before = errors.length;

    if (t.category !== 'bpmn') {
      if (!TASKLIKE.has(d.bpmnType)) errors.push(`${f}: bpmnType must be bpmn:Task or bpmn:SubProcess outside the bpmn category`);
    }
    if (d.eventDefinitionType && !EVENTS.has(d.bpmnType)) errors.push(`${f}: eventDefinitionType is only valid on event bpmnTypes`);
    if (d.stepType && !TASKLIKE.has(d.bpmnType)) errors.push(`${f}: stepType is only valid on bpmn:Task / bpmn:SubProcess`);
    if (d.isExpanded !== undefined && d.bpmnType !== 'bpmn:SubProcess') errors.push(`${f}: isExpanded is only valid on bpmn:SubProcess`);
    if (d.quickicon) for (const e of checkSvg(d.quickicon)) errors.push(`${f}: quickicon: ${e}`);
    if (d.replacedBy === t.id) errors.push(`${f}: replacedBy cannot point at itself`);

    const keys = new Set<string>();
    let keyValueCount = 0;
    for (const field of d.form as Record<string, any>[]) {
      const where = `${f}: form.${field.key}`;
      if (keys.has(field.key)) errors.push(`${where}: duplicate key`);
      keys.add(field.key);
      if (field.type === 'select' && !(field.options?.length > 0)) errors.push(`${where}: select fields need options`);
      if (field.type !== 'select' && field.options) errors.push(`${where}: options are only valid on select fields`);
      if (field.type === 'key-value') keyValueCount++;

      const inferred = inferStorage(d.bpmnType, field.key, field.type);
      if (inferred === null) {
        errors.push(`${where}: key collides with a built-in BPMN property on ${d.bpmnType}; choose another key`);
        continue;
      }
      const storage = field.storage ?? inferred;
      const kind = declaredKind(d.bpmnType, field.key);
      if (storage === 'properties' && field.type !== 'key-value') errors.push(`${where}: storage "properties" requires type key-value`);
      if (field.type === 'key-value' && storage !== 'properties') errors.push(`${where}: key-value fields must use storage "properties"`);
      if (storage === 'native' && kind !== 'native') errors.push(`${where}: storage "native" is only valid for name/text where ${d.bpmnType} declares them`);
      if (storage === 'attr' && kind !== 'dai-attr') errors.push(`${where}: storage "attr" requires a dai: attribute declared for ${d.bpmnType} (see schema/dai-moddle.json)`);
      if (storage === 'field' && kind !== 'none' && field.type !== 'key-value') errors.push(`${where}: key is already declared on ${d.bpmnType}; use storage "${inferred}" or another key`);
    }
    if (keyValueCount > 1) errors.push(`${f}: at most one key-value field per type`);

    if (errors.length === before) validTypes.push(buildType(t));
  }

  // ── cross-type uniqueness ─────────────────────────────────────────────────
  const owners = new Map<string, string>();
  const claim = (token: string, owner: string, what: string) => {
    const prev = owners.get(token);
    if (prev && prev !== owner) errors.push(`${owner}: ${what} "${token}" is already used by ${prev}`);
    else owners.set(token, owner);
  };
  const byId = new Map<string, CatalogType>();
  for (const t of validTypes) {
    byId.set(t.id, t);
    claim(t.id, t.id, 'id');
  }
  for (const t of validTypes) {
    for (const a of t.aliases ?? []) claim(a, t.id, 'alias');
    if (t.stepType) claim(`stepType:${t.stepType}`, t.id, 'stepType');
  }
  const bpmnSlots = new Map<string, string>();
  for (const t of validTypes.filter(t => t.category === 'bpmn')) {
    const slot = `${t.bpmnType}|${t.eventDefinitionType ?? ''}|${t.stepType ?? ''}`;
    const prev = bpmnSlots.get(slot);
    if (prev) errors.push(`${t.id}: bpmnType/eventDefinitionType pair already used by ${prev}`);
    else bpmnSlots.set(slot, t.id);
  }
  for (const base of ['bpmn:Task', 'bpmn:SubProcess']) {
    if (validTypes.length && !validTypes.some(t => t.category === 'bpmn' && t.bpmnType === base && !t.stepType)) {
      errors.push(`types/bpmn: a base ${base} type without stepType is required (editor fallback)`);
    }
  }
  for (const t of validTypes) {
    if (t.replacedBy) {
      const target = byId.get(t.replacedBy);
      if (!target) errors.push(`${t.id}: replacedBy ${t.replacedBy} does not exist`);
      else if (target.deprecated) errors.push(`${t.id}: replacedBy ${t.replacedBy} is itself deprecated`);
    }
  }

  // ── pattern categories: iconType ──────────────────────────────────────────
  for (const [key, cat] of Object.entries(repo.patternCategories)) {
    const iconType = (cat.data as any).iconType;
    if (iconType && !byId.has(iconType)) errors.push(`${rel(cat.file)}: iconType ${iconType} does not exist`);
    void key;
  }

  return { errors, types: validTypes };
}

/** Pattern checks are async (XML parsing). */
export async function validatePatterns(repo: Repo, types: CatalogType[]): Promise<string[]> {
  const errors: string[] = [];
  const typeIds = new Map<string, CatalogType>();
  const stepTypes = new Map<string, CatalogType>();
  for (const t of types) {
    typeIds.set(t.id, t);
    for (const a of t.aliases ?? []) typeIds.set(a, t);
    if (t.stepType) stepTypes.set(t.stepType, t);
  }
  const patternTokens = new Map<string, string>();

  for (const p of repo.patterns) {
    const f = rel(p.file);
    const df = rel(p.daiFile);
    for (const n of findNulls(p.data)) errors.push(`${f}: null value at ${n}`);
    errors.push(...schemaErrors(p.file, validatePatternSchema, p.data));
    for (const token of [p.id, ...(((p.data as any).aliases ?? []) as string[])]) {
      const prev = patternTokens.get(token);
      if (prev) errors.push(`${f}: id/alias "${token}" already used by ${prev}`);
      else patternTokens.set(token, p.id);
    }

    let parsed;
    try {
      parsed = await moddle.fromXML(p.xml);
    } catch (err) {
      errors.push(`${df}: XML does not parse: ${(err as Error).message}`);
      continue;
    }
    for (const w of parsed.warnings) errors.push(`${df}: ${w.message}`);
    const defs = parsed.rootElement;
    if (defs.$type !== 'bpmn:Definitions') {
      errors.push(`${df}: root element must be bpmn:definitions`);
      continue;
    }
    const roots: any[] = defs.rootElements ?? [];
    const processes = roots.filter(r => r.$type === 'bpmn:Process');
    if (processes.length !== 1) errors.push(`${df}: must contain exactly one bpmn:process (found ${processes.length})`);
    if (roots.some(r => r.$type === 'bpmn:Collaboration')) errors.push(`${df}: collaborations/pools are not allowed`);
    if (!processes[0]) continue;

    // Walk every flow element / artifact, recursing into sub-processes.
    const elements: any[] = [];
    const walk = (container: any) => {
      if (container.laneSets?.length) errors.push(`${df}: lanes are not allowed (${container.id})`);
      for (const el of [...(container.flowElements ?? []), ...(container.artifacts ?? [])]) {
        elements.push(el);
        if (el.flowElements || el.artifacts) walk(el);
      }
    };
    walk(processes[0]);

    const diagramRefs = new Set<any>();
    for (const diagram of defs.diagrams ?? []) {
      for (const pe of diagram.plane?.planeElement ?? []) if (pe.bpmnElement) diagramRefs.add(pe.bpmnElement);
    }
    for (const el of elements) {
      if (el.$type === 'bpmn:DataObject') continue; // DataObject has no DI; its reference does
      if (!diagramRefs.has(el)) errors.push(`${df}: element ${el.id} (${el.$type}) has no diagram shape/edge`);

      const typeRef: string | undefined = el.type;
      const stepType: string | undefined = el.stepType;
      if (typeRef) {
        const t = typeIds.get(typeRef);
        if (!t) errors.push(`${df}: ${el.id} dai:type "${typeRef}" does not exist`);
        else {
          if (t.bpmnType !== el.$type) errors.push(`${df}: ${el.id} is ${el.$type} but ${t.id} is ${t.bpmnType}`);
          if (stepType && t.stepType !== stepType) errors.push(`${df}: ${el.id} dai:stepType "${stepType}" disagrees with dai:type ${t.id}`);
        }
      } else if (stepType && !stepTypes.has(stepType)) {
        errors.push(`${df}: ${el.id} dai:stepType "${stepType}" does not exist`);
      }
    }
  }
  return errors;
}
