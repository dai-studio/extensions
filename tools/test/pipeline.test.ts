import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.ts';
import {
  generateKeyPair, importPrivateKey, importPublicKey, signObject, verifyObject, verifyString,
} from '../lib/crypto.ts';
import { checkSvg, EXAMPLE_ALLOWLIST } from '../lib/svg.ts';
import { checkCss, checkHtml } from '../lib/embed.ts';
import { checkCompat, removedPatterns, removedTypes, renamedTypes } from '../lib/compat.ts';
import { validatePatterns, validateRepo } from '../lib/validate.ts';
import { loadRepo, ROOT, type LoadOptions, type Repo } from '../lib/repo.ts';
import { checkAll } from '../lib/pipeline.ts';
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

function mutate(fn: (repo: Repo) => void, opts: LoadOptions = {}): string[] {
  const repo = structuredClone(loadRepo(ROOT, opts));
  fn(repo);
  return validateRepo(repo).errors;
}
const typeById = (repo: Repo, id: string) => repo.types.find(t => t.id === id)!;
/** types/ + unpublished/ (unpublished types are validated, never published). */
const WITH_UNPUBLISHED: LoadOptions = { includeUnpublished: true };

test('the repository itself validates', async () => {
  const repo = loadRepo();
  const { errors, types } = validateRepo(repo);
  assert.deepEqual(errors, []);
  assert.deepEqual(await validatePatterns(repo, types), []);
  assert.deepEqual(validateRepo(loadRepo(ROOT, WITH_UNPUBLISHED)).errors, [], 'types/ + unpublished/ validate together');
});

test('unpublished types are validated but never published', async () => {
  const full = loadRepo(ROOT, WITH_UNPUBLISHED);
  const unpublished = full.types.filter(t => t.unpublished);
  assert.ok(unpublished.length > 0, 'unpublished/ has types');
  assert.ok(unpublished.every(t => t.file.includes(`${path.sep}unpublished${path.sep}`)));
  assert.equal(loadRepo().types.some(t => t.unpublished), false, 'loadRepo() reads types/ only');

  // The catalog leaves them (and their categories) out.
  const { catalog, errors, unpublishedTypes } = await checkAll();
  assert.deepEqual(errors, []);
  assert.equal(unpublishedTypes, unpublished.length);
  const ids = new Set(catalog!.types.map(t => t.id));
  for (const t of unpublished) assert.equal(ids.has(t.id), false, `${t.id} is not published`);
  for (const cat of new Set(unpublished.map(t => t.category))) {
    assert.equal(cat in catalog!.categories.types, false, `category ${cat} is not published`);
  }

  // …but they are still validated.
  const victim = unpublished[0].id;
  assert.match(mutate(r => { typeById(r, victim).data.bpmnType = 'bpmn:StartEvent'; }, WITH_UNPUBLISHED).join('\n'), /bpmnType must be bpmn:Task or bpmn:SubProcess/);

  // A pattern may not reference an unpublished type.
  const repo = structuredClone(loadRepo());
  repo.patterns[0].xml = repo.patterns[0].xml.replace(/dai:type="[^"]+"/, `dai:type="${victim}"`);
  const unpublishedIds = new Set(unpublished.map(t => t.id));
  const published = validateRepo(full).types.filter(t => !unpublishedIds.has(t.id));
  assert.match((await validatePatterns(repo, published)).join('\n'), /does not exist/);
});

test('a category may not exist in both types/ and unpublished/', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dai-ext-'));
  try {
    for (const dir of ['types/business', 'unpublished/business']) {
      cpSync(path.join(ROOT, 'types/business'), path.join(root, dir), { recursive: true });
    }
    const errs = loadRepo(root, WITH_UNPUBLISHED).errors.join('\n');
    assert.match(errs, /category "business" exists in both types\/ and unpublished\//);
    assert.deepEqual(loadRepo(root).errors, [], 'without unpublished/ there is no conflict');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

// ── design types + embeds ───────────────────────────────────────────────────

const DESIGN = ['design', 'design-brand', 'design-components', 'design-layouts', 'design-guidance', 'design-assets'];

test('design categories live in the design view and their types are plain Tasks', () => {
  const repo = loadRepo(ROOT, WITH_UNPUBLISHED);
  for (const cat of DESIGN) {
    assert.equal((repo.typeCategories[cat]?.data as any)?.view, 'design', `${cat} has view: design`);
  }
  const design = repo.types.filter(t => DESIGN.includes(t.category));
  assert.equal(design.length, 38);
  for (const t of design) {
    const d = t.data as any;
    assert.equal(d.bpmnType, 'bpmn:Task', `${t.id} is a bpmn:Task`);
    assert.equal(d.isExpanded, undefined, `${t.id} has no isExpanded`);
  }
});

test('design components ship html + css examples; guidance carries instruction, priority, rationale', () => {
  const repo = loadRepo(ROOT, WITH_UNPUBLISHED);
  const field = (t: Repo['types'][number], key: string) => ((t.data as any).form as any[]).find(f => f.key === key);
  for (const t of repo.types.filter(x => x.category === 'design-components')) {
    assert.equal(field(t, 'html')?.type, 'html', `${t.id} html field`);
    assert.ok(field(t, 'html')?.example, `${t.id} html example`);
    assert.equal(field(t, 'css')?.type, 'css', `${t.id} css field`);
    assert.ok(field(t, 'css')?.example, `${t.id} css example`);
  }
  for (const t of repo.types.filter(x => x.category === 'design-guidance' && x.leaf !== 'agent-role')) {
    assert.equal(field(t, 'instruction')?.type, 'markdown', `${t.id} instruction`);
    if (t.leaf !== 'design-brief') assert.equal(field(t, 'priority')?.type, 'select', `${t.id} priority`);
    assert.ok(field(t, 'rationale'), `${t.id} rationale`);
  }
  // Embed fields store as <dai:field> bodies.
  const css = buildType(typeById(repo, 'dai.types.design-components.button')).form.find(f => f.key === 'css')!;
  assert.equal(css.storage, 'field');
});

test('embed examples: accepted when safe', () => {
  assert.deepEqual(checkHtml('<button class="b" type="button" aria-label="x">Go</button><a href="#top">Top</a><style>.b{color:red}</style>'), []);
  assert.deepEqual(checkCss('.a{background:url(#grad);color:var(--x, #fff)} @keyframes s{to{opacity:1}}'), []);
  assert.deepEqual(checkCss('html{scroll-behavior:smooth;overscroll-behavior:contain}'), []);
  assert.deepEqual(checkSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>T</title><defs><linearGradient id="g"><stop offset="0" stop-color="#fff" /></linearGradient></defs><rect fill="url(#g)" width="10" height="10" /><use href="#g" /><text x="1" y="9">Hi</text></svg>', EXAMPLE_ALLOWLIST), []);
});

test('embed examples: unsafe html, css and svg are rejected', () => {
  const html = [
    '<script>alert(1)</script>',
    '<img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '<img src="https://evil.example/p.gif">',
    '<img src="//evil.example/p.gif">',
    '<iframe srcdoc="x"></iframe>',
    '<link rel="stylesheet" href="a.css">',
    '<form action="/x"></form>',
    '<div style="background:url(https://evil.example)"></div>',
    '<style>@import "x.css";</style>',
    '<!-- hidden -->',
  ];
  for (const h of html) assert.notDeepEqual(checkHtml(h), [], h);
  const css = ['@import url(x.css);', '.a{background:url(https://e.x/a.png)}', '.a{background:url(data:image/png;base64,AA)}', '.a{width:expression(alert(1))}', '.a{behavior:url(x.htc)}', '</style><script>', '@font-face{font-family:x;src:local(x)}'];
  for (const c of css) assert.notDeepEqual(checkCss(c), [], c);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://e.x/s.svg#a" /></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://e.x)" /></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject /></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><g>loose text</g></svg>',
  ];
  for (const s of svg) assert.notDeepEqual(checkSvg(s, EXAMPLE_ALLOWLIST), [], s);
  // Quickicons keep the strict allowlist: no text, no url(#…).
  assert.notDeepEqual(checkSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>'), []);
});

test('rejects misplaced, unsafe and oversized examples', () => {
  const button = 'dai.types.design-components.button';
  const form = (r: Repo) => (typeById(r, button).data.form as any[]);
  assert.match(mutate(r => { form(r).find(f => f.key === 'status').example = 'x'; }, WITH_UNPUBLISHED).join('\n'), /example is only valid on/);
  assert.match(mutate(r => { form(r).find(f => f.key === 'html').example = '<script>x</script>'; }, WITH_UNPUBLISHED).join('\n'), /form\.html: example: <script> is not allowed/);
  assert.match(mutate(r => { form(r).find(f => f.key === 'css').example = '@import "x";'; }, WITH_UNPUBLISHED).join('\n'), /form\.css: example: @import/);
  assert.match(mutate(r => { form(r).find(f => f.key === 'html').example = 'x'.repeat(16385); }, WITH_UNPUBLISHED).join('\n'), /must NOT have more than 16384 characters/);
  assert.match(mutate(r => {
    const big = '.a{}'.repeat(4000);
    for (const k of ['html', 'css', 'usage', 'accessibility']) {
      const f = form(r).find(x => x.key === k);
      f.example = k === 'html' ? '<p>' + 'x'.repeat(15000) + '</p>' : big;
    }
  }, WITH_UNPUBLISHED).join('\n'), /examples total \d+ bytes \(max 49152\)/);
  assert.match(mutate(r => { form(r).find(f => f.key === 'html').type = 'nope'; }, WITH_UNPUBLISHED).join('\n'), /must be equal to one of the allowed values/);
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
