/**
 * Loads the extensions repository from disk into an in-memory model.
 *
 *   types/<category>/_category.yaml
 *   types/<category>/<leaf>.yaml            -> dai.types.<category>.<leaf>
 *   patterns/<category>/_category.yaml
 *   patterns/<category>/<leaf>.yaml + .dai  -> dai.patterns.<category>.<leaf>
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_PATTERN_BYTES = 256 * 1024;

export interface Loaded<T = Record<string, unknown>> {
  file: string;
  data: T;
}

export interface LoadedType extends Loaded {
  id: string;
  category: string;
  leaf: string;
}

export interface LoadedPattern extends Loaded {
  id: string;
  category: string;
  leaf: string;
  daiFile: string;
  xml: string;
}

export interface Repo {
  typeCategories: Record<string, Loaded>;
  patternCategories: Record<string, Loaded>;
  types: LoadedType[];
  patterns: LoadedPattern[];
  errors: string[];
}

function rel(p: string): string {
  return path.relative(ROOT, p);
}

function readYaml(file: string, errors: string[]): Record<string, unknown> | null {
  try {
    const data = parseYaml(readFileSync(file, 'utf8'), { strict: true, uniqueKeys: true, prettyErrors: true });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      errors.push(`${rel(file)}: top level must be a mapping`);
      return null;
    }
    return data as Record<string, unknown>;
  } catch (err) {
    errors.push(`${rel(file)}: YAML parse error: ${(err as Error).message}`);
    return null;
  }
}

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter(n => !n.startsWith('.')).sort() : [];
}

export function loadRepo(root = ROOT): Repo {
  const repo: Repo = { typeCategories: {}, patternCategories: {}, types: [], patterns: [], errors: [] };
  const { errors } = repo;

  // ── types ────────────────────────────────────────────────────────────────
  const typesDir = path.join(root, 'types');
  for (const category of listDir(typesDir)) {
    const catDir = path.join(typesDir, category);
    if (!statSync(catDir).isDirectory()) {
      errors.push(`${rel(catDir)}: only category directories are allowed under types/`);
      continue;
    }
    if (!SEGMENT.test(category)) errors.push(`${rel(catDir)}: category name must match ${SEGMENT}`);
    for (const name of listDir(catDir)) {
      const file = path.join(catDir, name);
      if (name === '_category.yaml') {
        const data = readYaml(file, errors);
        if (data) repo.typeCategories[category] = { file, data };
        continue;
      }
      if (!name.endsWith('.yaml')) {
        errors.push(`${rel(file)}: only <leaf>.yaml files are allowed in a type category`);
        continue;
      }
      const leaf = name.slice(0, -'.yaml'.length);
      if (!SEGMENT.test(leaf)) errors.push(`${rel(file)}: file name must match ${SEGMENT}`);
      const data = readYaml(file, errors);
      if (data) repo.types.push({ file, data, id: `dai.types.${category}.${leaf}`, category, leaf });
    }
    if (!repo.typeCategories[category]) errors.push(`${rel(catDir)}: missing _category.yaml`);
  }

  // ── patterns ─────────────────────────────────────────────────────────────
  const patternsDir = path.join(root, 'patterns');
  for (const category of listDir(patternsDir)) {
    const catDir = path.join(patternsDir, category);
    if (!statSync(catDir).isDirectory()) {
      errors.push(`${rel(catDir)}: only category directories are allowed under patterns/`);
      continue;
    }
    if (!SEGMENT.test(category)) errors.push(`${rel(catDir)}: category name must match ${SEGMENT}`);
    const names = listDir(catDir);
    for (const name of names) {
      const file = path.join(catDir, name);
      if (name === '_category.yaml') {
        const data = readYaml(file, errors);
        if (data) repo.patternCategories[category] = { file, data };
        continue;
      }
      if (name.endsWith('.dai')) {
        if (!names.includes(name.slice(0, -4) + '.yaml')) errors.push(`${rel(file)}: missing metadata file ${name.slice(0, -4)}.yaml`);
        continue;
      }
      if (!name.endsWith('.yaml')) {
        errors.push(`${rel(file)}: only <leaf>.yaml + <leaf>.dai files are allowed in a pattern category`);
        continue;
      }
      const leaf = name.slice(0, -'.yaml'.length);
      if (!SEGMENT.test(leaf)) errors.push(`${rel(file)}: file name must match ${SEGMENT}`);
      const daiFile = path.join(catDir, `${leaf}.dai`);
      if (!existsSync(daiFile)) {
        errors.push(`${rel(file)}: missing pattern body ${leaf}.dai`);
        continue;
      }
      const size = statSync(daiFile).size;
      if (size > MAX_PATTERN_BYTES) {
        errors.push(`${rel(daiFile)}: ${size} bytes exceeds ${MAX_PATTERN_BYTES}`);
        continue;
      }
      const data = readYaml(file, errors);
      if (data) {
        repo.patterns.push({
          file, data, daiFile, xml: readFileSync(daiFile, 'utf8'),
          id: `dai.patterns.${category}.${leaf}`, category, leaf,
        });
      }
    }
    if (!repo.patternCategories[category]) errors.push(`${rel(catDir)}: missing _category.yaml`);
  }

  return repo;
}

export { rel };
