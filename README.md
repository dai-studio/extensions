# dai.studio extensions

This repo holds the open source **types** and **patterns** for [dai.studio](https://dai.studio).
When a change is merged to `main`, CI validates it, signs it and publishes it to
dev.dai.studio. When a `catalog-vX.Y.Z` tag is pushed, it is published to dai.studio.
You don't need to redeploy the editor for new types or patterns to show up.

```
dai.types.business.objective        → types/business/objective.yaml
dai.patterns.technology.kubernetes  → patterns/technology/kubernetes.yaml + kubernetes.dai
```

Every name has exactly four dot-separated segments: `dai.<types|patterns>.<category>.<leaf>`.
Each segment uses only `[a-z0-9-]`. The file path determines the name, so moving a file renames it.
Names are permanent (see [compatibility](#compatibility)).

## Layout

| Path | Contents |
| --- | --- |
| `types/<category>/_category.yaml` | Column label, order and tiles per row in the Types overlay |
| `types/<category>/<leaf>.yaml` | One type (see `schema/type.schema.json`) |
| `patterns/<category>/_category.yaml` | Label, order, colour and `iconType` (a `dai.types.*` id) |
| `patterns/<category>/<leaf>.yaml` + `.dai` | Pattern metadata plus a BPMN fragment |
| `schema/` | JSON Schemas, the SVG allowlist, and `dai-moddle.json` (a copy of the editor's dai: XML descriptor) |
| `keys/<kid>.json` | Public signing keys. The editor trusts the same keys (`publicKeys.ts`) |
| `test-vectors/` | Canonical-JSON and signature vectors that both repos replay in their tests |
| `tools/` | validate / build / sign / publish (Node 24, no build step) |

## Pipeline

```
PR (fork-safe, no secrets)       main (publish-dev env)            tag catalog-v* (publish-prod env)
  npm test                         npm test                          same, against dai.studio
  npm run build -- --against dev   npm run build -- --against dev    → dai-studio-data
  npm run dry-run (throwaway key)  npm run sign  (DAI_SIGNING_JWK)
                                   npm run publish:r2 → dev-dai-studio-data
```

R2 layout (in both buckets):

```
catalog/builds/<git-sha>/catalog.json          signed index: categories, types[], patterns[] with sha256
catalog/builds/<git-sha>/patterns/<id>.dai
catalog/current.json                           { "build": "<git-sha>" } (written last, so a partial upload never goes live)
```

The editor fetches `GET /api/catalog` and `GET /api/patterns/<id>`. It checks each
type's ECDSA P-256 signature, the catalog signature and each pattern's sha256 before
using anything. To roll back, point `catalog/current.json` at an earlier build.

## Local commands

```bash
npm ci
npm run validate                                    # schema + semantic checks
npm run build -- --against https://dev.dai.studio/api/catalog
npm run dry-run                                     # sign with a throwaway key and verify
npm test
```

## Compatibility

Documents saved in dai.studio refer to types by id, alias and `stepType`, and store field
values by `key` and `storage`. CI rejects any change that would break an existing document:

- Types may be deleted: they drop out of the next published build, and documents that
  still use them lose the definition. If documents may still use a type, prefer
  `deprecated: true` with `replacedBy`.
- Patterns are never deleted. Mark them `deprecated: true`.
- `bpmnType`, `eventDefinitionType`, `stepType` and aliases can't change.
- Form fields can't be removed, and their `type` and `storage` can't change.
- `version` is informational; it may be bumped but never lowered.

## Setting up signing (maintainers)

1. `npm run keygen -- ci-2026-09` writes `keys/ci-2026-09.json` (public) and `ci-2026-09.private.jwk` (git-ignored).
2. Commit the public key. Add the same JWK under the same kid to
   `ws-dai-studio/editor-src/src/lib/types/publicKeys.ts` and deploy the editor.
3. Create the GitHub environments `publish-dev` and `publish-prod` (see `.github/workflows/publish.yml`)
   and set on **each**:

   | Name | Kind | Value |
   | --- | --- | --- |
   | `DAI_SIGNING_JWK` | secret | the whole one-line contents of `ci-2026-09.private.jwk` (the private key; contains `"d"`) |
   | `DAI_SIGNING_KID` | variable | just the text `ci-2026-09` — the key **id**, not a key |
   | `CLOUDFLARE_API_TOKEN` | secret | R2 Object Read & Write token scoped to that environment's bucket |
   | `CLOUDFLARE_ACCOUNT_ID` | variable | your Cloudflare account id |
   | `R2_BUCKET` | variable | `dev-dai-studio-data` / `dai-studio-data` |

   ```bash
   gh secret   set DAI_SIGNING_JWK --env publish-dev < ci-2026-09.private.jwk
   gh variable set DAI_SIGNING_KID --env publish-dev --body ci-2026-09
   ```

   Restrict `publish-prod` to `catalog-v*` tags.
4. Delete the local private key file.

To rotate the key, generate a new kid, ship its public key in the editor, switch
`DAI_SIGNING_KID`, publish, and then remove the old key from the editor.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a type or pattern.
