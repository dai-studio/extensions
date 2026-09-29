# Contributing types and patterns

A maintainer reviews every PR. Once it's merged, CI signs and publishes it. A signature
only proves that a contribution came through this pipeline; it doesn't prove the
contribution is safe. So reviews focus on content, and CI enforces strict allowlists.

## Add a type

1. Choose a category under `types/`, or add a new one with a `_category.yaml`
   (`label`, `order`, optional `columns`, and `view`: `basic` (default) or `cloud`, which
   picks the Types overlay tab the category appears under).
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
is allowed: it disappears from the next published build (documents that use it lose the
definition, so prefer `deprecated: true` + `replacedBy` if it may be in use). To rename or
move a type, move the file and add the old id to its `aliases`. Removing or renaming a pattern, field, alias or stepType, is not allowed; deprecate
it instead. CI checks every PR against the catalog that's currently published.
