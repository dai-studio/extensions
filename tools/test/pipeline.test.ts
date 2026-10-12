import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.ts';
import {
  generateKeyPair, importPrivateKey, importPublicKey, signObject, verifyObject, verifyString,
} from '../lib/crypto.ts';
import { checkSvg } from '../lib/svg.ts';
import { checkCompat, removedPatterns, removedTypes, renamedTypes } from '../lib/compat.ts';
import { validatePatterns, validateRepo } from '../lib/validate.ts';
import { loadRepo, ROOT, type Repo } from '../lib/repo.ts';
import { buildType, type CatalogType } from '../lib/catalog.ts';

const vectors = JSON.parse(readFileSync(path.join(ROOT, 'test-vectors', 'canonical.json'), 'utf8'));
const revive = (v: unknown): unknown => {
  if (v === '__undefined__') return undefined;
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  return v;
};

test('canonicalJson matches shared vectors', () => {
  for (const { input, canonical } of vectors.canonical) assert.equal(canonicalJson(revive(input)), canonical);
});

test('shared signature vectors verify', async () => {
  const key = await importPublicKey(vectors.testPublicKey);
  for (const { payload, signature } of vectors.signed) assert.ok(await verifyString(key, payload, signature));
  assert.equal(await verifyString(key, vectors.signed[0].payload + ' ', vectors.signed[0].signature), false);
});

test('signObject / verifyObject round-trip and tamper detection', async () => {
  const { privateJwk, publicJwk } = await generateKeyPair();
  const priv = await importPrivateKey(privateJwk);
  const pub = await importPublicKey(publicJwk);
  const signed = await signObject(priv, 'k1', { id: 'x', form: [{ key: 'a' }] });
  assert.equal(signed.kid, 'k1');
  assert.ok(await verifyObject(pub, signed));
  assert.equal(await verifyObject(pub, { ...signed, id: 'y' }), false);
  assert.equal(await verifyObject(pub, { ...signed, kid: 'k2' }), false, 'kid is covered by the signature');
});

test('checkSvg accepts the house style and rejects scripts/handlers/urls', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 1h2" /></svg>';
  assert.deepEqual(checkSvg(ok), []);
  const bad = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(#x)" d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" style="background:red"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><!-- hi --></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"></svg><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<div></div>',
    '<svg xmlns="http://www.w3.org/2000/svg">' + '<path d="M0 0"/>'.repeat(400) + '</svg>',
  ];
  for (const svg of bad) assert.notDeepEqual(checkSvg(svg), [], svg.slice(0, 60));
});

// ── validation against the real repo + synthetic mutations ─────────────────

function mutate(fn: (repo: Repo) => void): string[] {
  const repo = structuredClone(loadRepo());
  fn(repo);
  return validateRepo(repo).errors;
}
const typeById = (repo: Repo, id: string) => repo.types.find(t => t.id === id)!;

test('the repository itself validates', async () => {
  const repo = loadRepo();
  const { errors, types } = validateRepo(repo);
  assert.deepEqual(errors, []);
  assert.deepEqual(await validatePatterns(repo, types), []);
});

test('rejects nulls, bad storage, colliding keys, duplicate stepTypes and aliases', () => {
  assert.match(mutate(r => { typeById(r, 'dai.types.business.objective').data.description = null; }).join('\n'), /null value/);
  assert.match(mutate(r => {
    (typeById(r, 'dai.types.business.objective').data.form as any[]).push({ key: 'brandNew', label: 'X', type: 'text', storage: 'attr' });
  }).join('\n'), /storage "attr" requires/);
  assert.match(mutate(r => {
    (typeById(r, 'dai.types.business.objective').data.form as any[]).push({ key: 'id', label: 'X', type: 'text' });
  }).join('\n'), /collides with a built-in BPMN property/);
  assert.match(mutate(r => { typeById(r, 'dai.types.business.objective').data.stepType = 'agent'; }).join('\n'), /stepType "stepType:agent" is already used/);
  assert.match(mutate(r => {
    typeById(r, 'dai.types.business.objective').data.aliases = [...(typeById(r, 'dai.types.ai.agent').data.aliases as string[])];
  }).join('\n'), /alias .* already used/);
  assert.deepEqual(mutate(r => {
    typeById(r, 'dai.types.business.objective').data.aliases = ['dai.types.old-cat.objective'];
  }), [], 'a full type id is a valid alias (rename)');
  assert.match(mutate(r => {
    typeById(r, 'dai.types.business.objective').data.aliases = ['dai.types.ai.agent'];
  }).join('\n'), /alias "dai.types.ai.agent" is already used/);
  assert.match(mutate(r => {
    typeById(r, 'dai.types.business.objective').data.aliases = ['dai.types.x'];
  }).join('\n'), /must match pattern/);
  assert.match(mutate(r => { (r.typeCategories.aws.data as any).view = 'Cloud'; }).join('\n'), /must match pattern/);
  assert.match(mutate(r => { (r.typeCategories.aws.data as any).columns = 9; }).join('\n'), /columns must be <= 8/);
  assert.match(mutate(r => { typeById(r, 'dai.types.business.objective').data.bpmnType = 'bpmn:StartEvent'; }).join('\n'), /bpmnType must be bpmn:Task or bpmn:SubProcess/);
  assert.match(mutate(r => { typeById(r, 'dai.types.business.objective').data.license = 'paid'; }).join('\n'), /must be equal to constant/);
  assert.match(mutate(r => {
    typeById(r, 'dai.types.business.objective').data.quickicon = '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>';
  }).join('\n'), /quickicon: attribute "onload"/);
  assert.match(mutate(r => { typeById(r, 'dai.types.business.objective').data.colors = { fill: 'red;x', stroke: '#000' }; }).join('\n'), /must match pattern/);
});

test('cloud types belong to their category\'s named groups', () => {
  const repo = loadRepo();
  const cloud = ['cloud', 'aws', 'azure', 'gcp', 'cloudflare'];
  for (const cat of cloud) {
    const groups = (repo.typeCategories[cat].data as any).groups as { key: string; label: string }[];
    assert.ok(groups?.length > 0, `${cat} declares groups`);
    const keys = new Set(groups.map(g => g.key));
    for (const t of repo.types.filter(x => x.category === cat)) {
      assert.ok(keys.has((t.data as any).group), `${t.id} has a declared group`);
    }
  }
  assert.equal(buildType(typeById(repo, 'dai.types.aws.ec2-instance')).group, 'compute');
  assert.equal(buildType(typeById(repo, 'dai.types.aws.account')).group, 'hierarchy');
});

test('rejects unknown, missing, misplaced and duplicate groups', () => {
  assert.match(mutate(r => { typeById(r, 'dai.types.aws.ec2-instance').data.group = 'nope'; }).join('\n'), /unknown group "nope"/);
  assert.match(mutate(r => { delete typeById(r, 'dai.types.aws.ec2-instance').data.group; }).join('\n'), /group is required/);
  assert.match(mutate(r => { typeById(r, 'dai.types.business.objective').data.group = 'compute'; }).join('\n'), /declares no groups/);
  assert.match(mutate(r => {
    const groups = (r.typeCategories.aws.data as any).groups;
    groups.push({ ...groups[0] });
  }).join('\n'), /duplicate group key "hierarchy"/);
  assert.match(mutate(r => { (r.typeCategories.aws.data as any).groups[0].label = ''; }).join('\n'), /must NOT have fewer than 1 characters/);
  assert.match(mutate(r => { typeById(r, 'dai.types.aws.ec2-instance').data.group = 'Compute'; }).join('\n'), /must match pattern/);
});

test('cloud groups share one palette across all providers, and types use it', () => {
  const repo = loadRepo();
  const cloud = ['cloud', 'aws', 'azure', 'gcp', 'cloudflare'];
  const palette = new Map<string, string>();
  for (const cat of cloud) {
    for (const g of (repo.typeCategories[cat].data as any).groups as any[]) {
      const c = `${g.colors.stroke}/${g.colors.fill}`.toUpperCase();
      if (palette.has(g.key)) assert.equal(c, palette.get(g.key), `${cat}: ${g.key} palette`);
      else palette.set(g.key, c);
    }
  }
  for (const t of repo.types.filter(x => cloud.includes(x.category))) {
    const d = t.data as any;
    assert.equal(`${d.colors.stroke}/${d.colors.fill}`.toUpperCase(), palette.get(d.group), `${t.id} uses its group palette`);
  }
  assert.equal(palette.get('compute'), '#EA580C/#FFF7ED');
});

test('rejects off-palette type colours and diverging group palettes', () => {
  assert.match(mutate(r => {
    typeById(r, 'dai.types.aws.ec2-instance').data.colors = { fill: '#FEF5ED', stroke: '#ED7100' };
  }).join('\n'), /colors must match group "compute"/);
  assert.match(mutate(r => {
    const g = ((r.typeCategories.gcp.data as any).groups as any[]).find(x => x.key === 'compute');
    g.colors = { fill: '#E8F0FE', stroke: '#1A73E8' };
  }).join('\n'), /group "compute" colors .* differ from/);
});

test('rejects patterns referencing unknown types', async () => {
  const repo = structuredClone(loadRepo());
  repo.patterns[0].xml = repo.patterns[0].xml.replace(/dai:type="[^"]+"/, 'dai:type="dai.types.nope.nothing"');
  const { types } = validateRepo(repo);
  assert.match((await validatePatterns(repo, types)).join('\n'), /does not exist/);
});

test('patterns may put SubProcess-declared types on a bpmn:task (Task/SubProcess are interchangeable)', async () => {
  const repo = structuredClone(loadRepo());
  const p = repo.patterns.find(x => x.xml.includes('dai:type="dai.types.azure.storage-account"'))!;
  p.xml = p.xml.replace('dai:type="dai.types.azure.storage-account"', 'dai:type="dai.types.azure.resource-group"');
  const { types } = validateRepo(repo);
  assert.deepEqual(await validatePatterns(repo, types), []);

  // A non-task-like type on a task is still an error.
  p.xml = p.xml.replace('dai:type="dai.types.azure.resource-group"', 'dai:type="dai.types.bpmn.start-event"');
  assert.match((await validatePatterns(repo, types)).join('\n'), /is bpmn:Task but dai\.types\.bpmn\.start-event is bpmn:StartEvent/);
});

// ── compatibility ───────────────────────────────────────────────────────────

test('compat: additive changes pass, destructive ones fail', () => {
  const repo = loadRepo();
  const prev = { types: repo.types.map(buildType), patterns: [] as any[] };
  const clone = (): CatalogType[] => structuredClone(prev.types);

  assert.deepEqual(checkCompat(prev, { types: clone(), patterns: [] }), []);

  const added = clone();
  const obj = added.find(t => t.id === 'dai.types.business.objective')!;
  obj.form.push({ key: 'extra', label: 'Extra', type: 'text', storage: 'field' });
  assert.deepEqual(checkCompat(prev, { types: added, patterns: [] }), [], 'content changes need no version bump');
  obj.version = '9.0.0';
  assert.deepEqual(checkCompat(prev, { types: added, patterns: [] }), []);
  obj.version = '0.9.0';
  assert.match(checkCompat(prev, { types: added, patterns: [] }).join('\n'), /version cannot go backwards/);

  const removed = clone().filter(t => t.id !== 'dai.types.business.objective');
  assert.deepEqual(checkCompat(prev, { types: removed, patterns: [] }), [], 'types may be removed');
  assert.deepEqual(removedTypes(prev, { types: removed }), ['dai.types.business.objective']);
  assert.deepEqual(renamedTypes(prev, { types: removed }), []);

  const moved = clone();
  const mv = moved.find(t => t.id === 'dai.types.business.objective')!;
  mv.id = 'dai.types.strategy.objective';
  mv.aliases = [...(mv.aliases ?? []), 'dai.types.business.objective'];
  assert.deepEqual(renamedTypes(prev, { types: moved }), [{ from: 'dai.types.business.objective', to: 'dai.types.strategy.objective' }]);

  const retyped = clone();
  const agent = retyped.find(t => t.id === 'dai.types.ai.agent')!;
  agent.version = '9.0.0';
  agent.form = agent.form.filter(f => f.key !== 'agentRole');
  agent.bpmnType = 'bpmn:Task';
  const errs = checkCompat(prev, { types: retyped, patterns: [] }).join('\n');
  assert.match(errs, /form field "agentRole" cannot be removed/);
  assert.match(errs, /bpmnType cannot change/);
});

test('compat: patterns may be removed, but not lose aliases or go backwards', () => {
  const pat = { id: 'dai.patterns.x.y', category: 'x', name: 'Y', description: '', version: '1.0.0', sha256: '', aliases: ['y'] };
  const prev = { types: [] as CatalogType[], patterns: [pat] };

  assert.deepEqual(checkCompat(prev, { types: [], patterns: [] }), [], 'patterns may be removed');
  assert.deepEqual(removedPatterns(prev, { patterns: [] }), ['dai.patterns.x.y']);
  assert.deepEqual(removedPatterns(prev, { patterns: [pat] }), []);

  const errs = checkCompat(prev, { types: [], patterns: [{ ...pat, version: '0.9.0', aliases: [] }] }).join('\n');
  assert.match(errs, /alias "y" cannot be removed/);
  assert.match(errs, /version cannot go backwards/);
});
