# Add 8 Software types: Client, System, Queue, Interface, Config, Job, Decision, Feature Flag

> Earlier plans in this file are implemented. This plan adds types to `types/software/` (Domains → Software) and rewords Business → Decision. It follows the same approach as the AI/ML, Business and Product additions.

## Decisions
- **Scope:**
  - **Extensions catalog:** the 8 new types plus a description change to `business/decision-record.yaml`.
  - **Editor (`ws-dai-studio`):** copy changes only, so Business → Decision's help text and `llms.txt` match the new wording.
  - New types get no `stepType` and no editor type code.
  - The editor's offline snapshot picks up both changes at the next `npm run catalog:snapshot` after a production publish. That refresh is out of scope here.
- **IDs:** `dai.types.software.{client,system,queue,interface,config,job,decision,feature-flag}`. None collide with existing types.
- **Bpmn types:**
  - **System** is a container: `bpmn:SubProcess`, `isExpanded: true`. It holds the Services, Clients, Databases, Queues and Jobs owned and released together. Environment stays the deployment-target container.
  - The other seven are `bpmn:Task`.
- **Decision overlap** (user's choice):
  - Software → Decision is the technical/architecture decision record (ADR).
  - Business → Decision keeps its id, name, `stepType: decision-record`, fields and alias. Only its description changes, to a business decision. Changing a description is allowed by the compat check.
- **Conventions:** match `types/software/*.yaml`.
  - Header comment `# dai.types.software.<leaf>`, `version: 1.0.0`, `license: free`.
  - Colours `fill: '#EFF6FF'`, `stroke: '#2563EB'`.
  - No `order` and no `group`.
  - Field order: `name` first, then the type-specific fields, then `owner` where listed, then `notes` (textarea "Notes") last.
  - Config has the only `key-value` field.
- **Reused dai: attribute keys** (`String` on Task/SubProcess): `status`, `owner`, `version`, `trigger`, `producer`, `consumers`, `broker`, `context`, `decision`, `consequences`, `format`, `path`, `language`, `engine`, `scope`, `source`. These infer `attr` storage; every other key infers `field`. Storage is frozen at first publish.
- **quickicon:** Tabler (MIT) path data in the house SVG wrapper (24×24, stroke 2, round caps/joins, allowlisted elements, ≤ 4 KB). Avoid icons already used in Software, Business or Product.

  | Type | Tabler icon |
  | --- | --- |
  | Client | `device-desktop` |
  | System | `topology-star-3` |
  | Queue | `stack-2` |
  | Interface | `plug` |
  | Config | `adjustments` |
  | Job | `clock-cog` |
  | Decision | `git-fork` |
  | Feature Flag | `toggle-right` |

  If an icon's Tabler path data is uncertain, pick a close Tabler icon instead. It must still be unique within Domains.

## Types (`types/software/<leaf>.yaml`)
Select options are `value` ("Label"); the label defaults to the title-cased value.

### 1. client — Client (Task)
- **Description:** "An application people use to reach the system: a web, mobile or desktop app, a CLI or an SDK. Different from Cloud → Client / User, which models the network actor."
- **Fields:**
  - `clientType` select "Type": web, mobile, desktop, cli ("CLI"), sdk ("SDK"), other
  - `platform` text "Platform", placeholder "e.g. iOS, Android, browser, macOS"
  - `framework` text "Framework", placeholder "e.g. React, SwiftUI, Flutter"
  - `url` text "URL / store link"
  - `auth` select "Auth": none, session, oauth ("OAuth / OIDC"), api-key ("API key"), other
  - `owner`
  - `notes`

### 2. system — System (SubProcess, isExpanded)
- **Description:** "A software system: the Services, Clients, Databases, Queues and Jobs that are owned and released together. Contains its parts; Environment is where they are deployed."
- **Fields:**
  - `boundary` select "Boundary", default `internal`: internal, external ("External / third party")
  - `status` select "Status", default `live`: planned, building, live, deprecated, retired
  - `docsUrl` text "Docs", placeholder "https://…"
  - `owner` (label "Owning team")
  - `notes`

### 3. queue — Queue (Task)
- **Description:** "A message queue, topic or stream that carries messages between services. Event describes the message contract; Queue is the channel it travels on."
- **Fields:**
  - `broker` select "Technology": rabbitmq ("RabbitMQ"), kafka ("Kafka"), sqs ("SQS"), nats ("NATS"), redis ("Redis"), pubsub ("Pub/Sub"), other
  - `pattern` select "Pattern", default `queue`: queue ("Queue (point-to-point)"), topic ("Topic (pub/sub)"), stream
  - `producer` text "Producers"
  - `consumers` text "Consumers"
  - `delivery` select "Delivery guarantee": at-most-once ("At most once"), at-least-once ("At least once"), exactly-once ("Exactly once")
  - `deadLetter` text "Dead-letter queue"
  - `notes`

### 4. interface — Interface (Task)
- **Description:** "A contract between parts of the system that is more than one HTTP endpoint: an OpenAPI, GraphQL, gRPC or AsyncAPI spec, a library or SDK interface, a CLI or a file format. Endpoint is a single operation; Model is a data shape."
- **Fields:**
  - `interfaceType` select "Type": rest ("REST / HTTP API"), graphql ("GraphQL"), grpc ("gRPC"), async ("Async / messaging"), library ("Library / SDK"), cli ("CLI"), file ("File format"), other
  - `format` select "Spec format": openapi ("OpenAPI"), graphql ("GraphQL SDL"), protobuf ("Protobuf"), asyncapi ("AsyncAPI"), typescript ("TypeScript"), json-schema ("JSON Schema"), other
  - `spec` code "Spec", placeholder "Paste or summarise the contract", rows 10
  - `version` text "Version"
  - `specUrl` text "Spec link", placeholder "https://…"
  - `owner`
  - `notes`

### 5. config — Config (Task)
- **Description:** "Configuration for a service or environment: settings, feature switches and secret references, and where they come from."
- **Fields:**
  - `format` select "Format": env (".env / environment variables"), yaml ("YAML"), json ("JSON"), toml ("TOML"), properties ("Properties"), other
  - `source` select "Source": file, config-service ("Config service"), vault ("Secrets manager / vault"), env ("Environment"), other
  - `path` text "Path / key", placeholder "e.g. config/production.yaml"
  - `settings` key-value "Settings"
  - `notes`

### 6. job — Job (Task)
- **Description:** "A background or scheduled worker that runs to completion: triggered by a schedule, a queue, an event or by hand. Pipeline stays CI/CD."
- **Fields:**
  - `trigger` select "Trigger", default `schedule`: schedule, queue, event, manual
  - `schedule` text "Schedule", placeholder "Cron, e.g. 0 3 * * *"
  - `runtime` text "Runtime", placeholder "e.g. Node.js worker, Sidekiq, Celery"
  - `timeout` text "Timeout", placeholder "e.g. 15m"
  - `retries` number "Retries", default 3, min 0
  - `idempotent` boolean "Idempotent", default false
  - `owner`
  - `notes`

### 7. decision — Decision (Task)
- **Description:** "A technical or architecture decision record (ADR): the context, the options considered, the decision and its consequences. For business decisions use Business → Decision."
- **Fields:**
  - `name` label "Title", placeholder "Decision title"
  - `status` select "Status", default `proposed`: proposed, accepted, deprecated, superseded
  - `context` textarea "Context"
  - `options` textarea "Options considered"
  - `decision` textarea "Decision"
  - `consequences` textarea "Consequences"
  - `deciders` text "Deciders"
  - `decidedOn` text "Date", placeholder "e.g. 2026-10-12"
  - `notes`

### 8. feature-flag — Feature Flag (Task)
- **Description:** "A runtime toggle that turns behaviour on or off without a deploy, for releases, experiments, operations or permissions. Records its key, default, rollout and when to remove it."
- **Fields:**
  - `flagKey` text "Flag key", placeholder "e.g. new-checkout"
  - `flagType` select "Type", default `release`: release, experiment, ops ("Operational"), permission
  - `defaultValue` text "Default", placeholder "e.g. off". This is a form *key*; check that the validator doesn't confuse it with the field property `defaultValue`. If it does, rename it to `defaultState`.
  - `rollout` number "Rollout %", min 0, max 100
  - `provider` select "Provider": openfeature ("OpenFeature"), launchdarkly ("LaunchDarkly"), unleash ("Unleash"), flagsmith ("Flagsmith"), config ("Config file"), other
  - `status` select "Status", default `active`: active, rolled-out ("Fully rolled out"), removed
  - `removeBy` text "Remove by", placeholder "e.g. 2027-01-31"
  - `owner`
  - `notes`

## Business → Decision rewording
- **`extensions/types/business/decision-record.yaml:5`** — new description: "A business decision: documents the context, the choice made and its consequences for future reference. For technical or architecture decisions use Software → Decision."
- **`ws-dai-studio/editor-src/src/lib/panel/HelpPanel.svelte:421-433`** (`HELP['decision-record']`)
  - Title: "Decision".
  - Description: "A business decision — captures an important choice, the context that led to it, and the consequences that follow. Use it to build a durable record of why the business chose what it did. For technical or architecture decisions, use Software → Decision."
  - Change the Title field example from "Use PostgreSQL for primary storage" to a business example, e.g. "Enter the EU market in Q2".
- **`ws-dai-studio/llms.txt`**
  - Line 234: "A business decision record. `status` is proposed/accepted/deprecated/superseded. Documents the context, the choice made and its trade-offs. Technical/architecture decisions use `dai.types.software.decision` (no stepType)."
  - Line 596: change "architectural choices are `decision-record`" to "business decisions are `decision-record` (architecture decisions are `dai.types.software.decision`)".

## Tasks
1. Write the 8 YAML files in `/Users/ted/Dev/_dai/extensions/types/software/` using the same generator approach as for the Product types (temp Python script, plain YAML output). Edit the description in `business/decision-record.yaml`.
2. Add a test to `tools/test/pipeline.test.ts`, mirroring the Product test. It asserts:
   - all 8 IDs exist;
   - System is an expanded SubProcess and the rest are Tasks;
   - every type uses the Software palette (`#EFF6FF` / `#2563EB`);
   - `notes` is the last field;
   - `software.decision` and `business.decision-record` each mention the other in their description.
3. Extensions: run `npm run validate`, `npm test` and `npm run build -- --against https://dev.dai.studio/api/catalog`. The change is additive plus a description change, so it must pass. Report the inferred storage of the new fields from `dist/catalog.json`.
4. Editor: make the HelpPanel and `llms.txt` edits, then run `npx vitest run` in `editor-src`.

## Out of scope
- New stepTypes or editor HelpPanel entries for the new types. The help panel falls back to each type's own description and fields.
- Refreshing the offline snapshot, patterns, and a C4 diagram template.

## Validation
- After publishing to dev, Domains → Software lists 20 types in A–Z order.
- A System expands on the canvas and accepts nested Services, Clients, Databases, Queues and Jobs.
- Searching "decision" shows the Software and Business Decision tiles with descriptions that tell them apart.
- The help panel for a Business Decision shows the business wording.
