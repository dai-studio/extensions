# Contributing types and patterns

A maintainer reviews every PR. Once it's merged, CI signs and publishes it. A signature
only proves that a contribution came through this pipeline; it doesn't prove the
contribution is safe. So reviews focus on content, and CI enforces strict allowlists.

## Add a type

1. Choose a category under `types/`, or add a new one with a `_category.yaml`
   (`label`, `order`, optional `columns`, and `view`: `basic` (default), `cloud`, `open-source`
   or `design`, which picks the Types overlay tab the category appears under). `cloud`,
   `open-source` and `design` are paid views; the editor must know a view before a category
   using it is published, or the category falls into the free "Other" tab.
2. Create `types/<category>/<leaf>.yaml`. That file becomes `dai.types.<category>.<leaf>`.

```yaml
name: Objective
version: 1.0.0
description: A measurable goal with key results.
icon: ◎                          # short plain-text glyph (≤ 8 chars)
quickicon: <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" /></svg>
colors: { fill: '#eef2ff', stroke: '#4338ca' }
bpmnType: bpmn:Task              # bpmn:Task or bpmn:SubProcess outside the bpmn category
license: free
form:
  - { key: name,  label: Name,  type: text }
  - { key: owner, label: Owner, type: text }
  - { key: kpiUrl, label: Dashboard, type: text, placeholder: https://… }
```

Rules:

- New types don't need a `stepType`. Documents refer to them with `dai:type="dai.types.…"`.
  `stepType` exists only for types migrated from the old built-ins.
- `quickicon` may only use `svg g path circle ellipse rect line polyline polygon` plus
  presentation attributes. It can't contain scripts, event handlers, `style`, `href` or `url(…)`,
  and must be 4 KB or less. See `schema/svg-allowlist.json`.
- Colours must be `#hex`. Every YAML value must be non-null; omit a key instead of leaving it empty.

### Where field values are stored (`storage`)

You rarely need to set `storage`. If you leave it out, CI infers it and writes the result into
the signed catalog:

| Inferred when | `storage` | Saved in the .dai file as |
| --- | --- | --- |
| `name` / `text` | `native` | the standard BPMN property |
| a `dai:` attribute already declared for that `bpmnType` (e.g. `notes`, `owner` on tasks) | `attr` | `dai:owner="…"` |
| `type: key-value` | `properties` | `<dai:properties>` |
| any other key | `field` | `<dai:fields><dai:field key="kpiUrl">…</dai:field></dai:fields>` |

After a type is published, a field's storage can never change. If a later change to the
editor's schema would change the inferred value, CI tells you to set the original value
explicitly.

### Embed fields (`html`, `css`, `svg`) and `example`

`html`, `css` and `svg` fields hold markup the editor previews inside a sandboxed iframe
(no scripts, no network). A field of type `html`, `css`, `svg`, `code` or `markdown` may set
`example` (16 KB max; 48 KB per type). The editor copies it into the element when the element
is created, so it is saved in the .dai file and agents can read it.

```yaml
  - key: css
    label: CSS
    type: css
    example: |-
      .dai-button { background: var(--dai-color-primary, #2563eb); }
```

CI rejects examples that could run code or reach the network (`tools/lib/embed.ts`):

- **HTML**: no `script iframe frame object embed applet link meta base portal`, no `on*`
  handlers, `srcdoc`, `action`/`formaction`, comments, or `src`/`href` with a scheme or `//`
  (use `#fragment` or relative values). `style` attributes and `<style>` blocks follow the CSS rules.
- **CSS**: no `@import`, `@font-face` sources, `expression()`, `behavior:`, `-moz-binding`,
  `javascript:` or `</`; `url()` may only point at `#fragment`.
- **SVG**: `schema/svg-example-allowlist.json` (the quickicon list plus text, gradients,
  `defs`, `clipPath`, `mask`, `symbol`, `use`, `title`, `desc`); `href` and `url()` must be `#fragment`.

### Design types

The `design-*` categories form the paid **Design** view. They currently live in `unpublished/`
(validated by CI, not in the catalog) until the editor's Design view ships; publish them with
`git mv unpublished/design* types/`. Every Design type is a `bpmn:Task`.
Any type can nest in any other, and the nesting carries the meaning:

- **Scope**: an element applies within its parent. Guidance applies to what it is nested in.
- **Cascade**: tokens nested higher up apply below them; the nearest wins.
- **Parts**: children of a component or layout are its parts.
- **Modifiers**: `variant` and `state` children modify their parent.
- **Definition vs usage**: anything under a `design-system` is a definition. A component
  nested elsewhere is a usage of the definition with the same type and name.

Example CSS uses the `--dai-*` custom properties defined by the Foundations examples, with a
fallback value (`var(--dai-color-primary, #2563eb)`) so each preview renders on its own.

### Open Source types

The `oss-*` categories (`view: open-source`) form the paid **Open Source** view: one type per
open-source project, grouped by layer (OS, Virtualization, Containers, Networking, Web & Proxy,
Runtimes, Frameworks, Database, Messaging, Data & Analytics, Storage, Security & Identity,
Observability, DevOps, Integration & Platforms, AI & ML, Business Apps). They live in
`unpublished/oss-*` until the editor's Open Source view and its unlock ship in production;
publish them with `git mv unpublished/oss-* types/`.

- **Ids**: `dai.types.oss-<category>.<project>`, e.g. `dai.types.oss-database.postgresql`.
- **Inclusion**: OSI-approved projects plus widely used source-available ones. Every
  description ends with `License: <SPDX id or name>.`; source-available projects add
  `(source-available)` (the list is in `tools/test/pipeline.test.ts`). Never add a form field
  with the key `license`.
- **Colours**: one palette per category, used by all of its groups. Group keys are unique
  across the whole view.
- **Containers** (`bpmn:SubProcess`, `isExpanded: true`): OS distributions, hypervisors and
  private clouds, container hosts (Docker Engine, Podman, Incus) and orchestrators. Everything
  else is a `bpmn:Task`. Descriptions say where an element goes ("Place it inside an OS,
  container host or Kubernetes cluster").
- **Form profiles**: every type starts with `name` and ends with `tags` and `notes`. In between:
  - host: `version`, `architecture` (OS only), `nodeCount`
  - service: `version`, `deployment`, `port` (the project's default), `replicas`, `endpoint`,
    optional `config`
  - library: `version`
  - tool: `version`, `configPath`
  - model: `variant`, `parameters`, `quantization`, `contextWindow`, `servedBy`

## Add a pattern

1. Create `patterns/<category>/<leaf>.yaml`:

```yaml
name: Kubernetes
description: Create a Deployment and expose it with a Service.
version: 1.0.0
```

2. Create `patterns/<category>/<leaf>.dai` next to it. It must be a complete
   `<bpmn:definitions>` with exactly one `<bpmn:process>`, no pools or lanes, and a diagram
   shape or edge for every element. Refer to types with `dai:type="dai.types.…"`. Every
   referenced type must exist.

The easiest way to write a pattern is to build it in dai.studio, download the `.dai` file
and trim it down.

## Changing something that's already published

You don't need to bump `version` (you may, but it can't go down). Adding form fields, options and aliases is fine. Deleting a type
or pattern is allowed: it disappears from the next published build (documents that use a
deleted type lose the definition, so prefer `deprecated: true` + `replacedBy` if it may be in
use). To rename or move a type, move the file and add the old id to its `aliases`. Removing
or renaming a field, alias or stepType is not allowed; deprecate it instead. CI checks every PR against the catalog that's currently published.
