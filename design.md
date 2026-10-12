# Design Types: Simplest Version

## Goal
Add a paid **Design** tab, next to Essential and Cloud, with types that:
1. define a design system,
2. guide agents through the soft side of design work,
3. carry HTML, CSS and SVG examples.

## Core decisions
- **Types:** every type is `bpmn:Task`, so any type can nest in any other (the editor already handles this). There are no container types.
- **Composition:** meaning comes from nesting alone. There is no new editor code for this; the rules live in `llms.txt` and in each type's description:
  - **Scope:** an element applies inside its parent. Guidance applies to whatever it is nested in.
  - **Cascade:** tokens nested higher up apply below them, and the nearest one wins.
  - **Parts:** children of a component or layout are its parts.
  - **Modifiers:** `variant` and `state` children modify their parent.
  - **Definition vs usage is decided by position.** Anything under a `design-system` is a definition. A component nested elsewhere is a usage of the definition with the same type and name.
- **Embeds:**
  - New form field types `html`, `css` and `svg`.
  - A field property `example` (≤16 KB) that is copied into the element when the element is created.
  - Each embed field gets a standalone preview in a sandboxed iframe. An HTML preview includes the same element's CSS.
- **Commercial:** a one-time unlock that works the same way as Cloud. It is a soft gate on the tab in the editor, and the types stay `license: free`.

## Types (38): view `design`, category folders prefixed `design-`
| Category (label) | Types |
|---|---|
| `design` (Foundations) | design-system, theme, color, typography, spacing, radius, elevation, motion, breakpoint |
| `design-brand` (Brand) | brand, logo (svg), voice, tone |
| `design-components` (Components) | component, variant, state, button, input, card, modal, navigation, table, alert |
| `design-layouts` (Layouts) | page, section, screen, user-flow |
| `design-guidance` (Agent Guidance) | design-brief, design-principle, design-rule, accessibility-rule, do-dont, critique-rubric, agent-role, feedback |
| `design-assets` (Assets) | svg, html, css |

Fields:
- **Tokens:** `name`, `tokenName`, `value`, `usage`, `css`, `tags`, `notes`.
- **Components:** `name`, `status`, `html`, `css`, `accessibility` (markdown), `usage` (markdown), `tags`, `notes`.
- **Guidance:** `name`, `instruction` (markdown), `priority` (must/should/may), `rationale`, `tags`, `notes`.

Each category has a single group palette, so no `groups` are needed. The example CSS uses only `--dai-*` variables, which are defined by the Foundations examples.

## Tasks

### `extensions` repo
1. `schema/type.schema.json`:
   - add `html`, `css` and `svg` to the field type enum;
   - add `example` (string, max 16384) for html, css, svg, code and markdown fields.
2. `tools/lib/validate.ts`: reject unsafe examples.
   - **HTML:** script, iframe, object, embed, link, meta, base, `on*=`, `javascript:`, and external `src`, `href` or `url(`.
   - **CSS:** `@import`, external `url(`, `expression(`.
   - **SVG:** reuse the quickicon allowlist plus `text`, `defs`, gradients, `title`.
3. `tools/test/pipeline.test.ts`:
   - new field types are accepted;
   - unsafe examples are rejected;
   - every Design type uses `bpmn:Task` and `view: design`.
4. Add 6 `_category.yaml` files and 38 type YAMLs in house style.
5. Document the new field types in `CONTRIBUTING.md`.

### `ws-dai-studio` repo
6. `typeViews.ts`: add view `design` (label "Design") with the 6 categories. Add fallbacks to `categories.ts`.
7. `TypeDefinition.ts`: add the new field types and `example`.
8. `DynamicPanel.svelte`: add an `EmbedField` with a Code/Preview toggle.
   - The preview is an `<iframe sandbox="" srcdoc>` with CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:`.
   - Add a monospace fallback for unknown field types.
9. `createType.ts`: seed `example` values on create.
10. Paywall:
    - generalise `billing/entitlements.ts` into per-view unlocks;
    - add a `designUnlocked` store;
    - make the CTA generic.
11. Billing:
    - product `design`;
    - the `STRIPE_PRICE_DESIGN` secret;
    - `types_design_unlocked` on the account;
    - status and editor metadata;
    - `grant.ts --design`.
12. `llms.txt`: add a Design section covering the categories, the composition rules and one nested XML example.

## Rollout
1. Ship tasks 1–3 (schema and validator only).
2. Deploy the editor (tasks 6–12) **before** any Design types are published. Otherwise the types land in the free "Other" tab.
3. Set the Stripe price, then merge task 4 and verify on dev:
   - the gate;
   - previews;
   - the `.dai` file round-trip keeps the embed bodies.
4. Tag `catalog-v*` to publish to prod.

## Validation
- `npm run check` in `extensions`.
- Editor unit tests and typecheck.
- On dev:
  - pasted `<img src=https://…>` or `onerror` HTML runs nothing and makes no network requests;
  - the Design tab is locked until purchase.

## Deferred (add later if needed)
- A `ref` field for explicit definition-vs-usage links.
- Composed previews (CSS cascading down, child HTML into slots).
- Design patterns and pattern gating.
- The larger type set (full component library, scales, groups).
- Token export.
