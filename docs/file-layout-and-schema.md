# File Layout and Schema

## Goal

Define an actual file and data layout for the organic selfhood extension.

This document is intentionally concrete.

## Repo-side layout

Recommended package layout:

```text
pi-organic-persona-extension/
  SOUL.md
  README.md
  package.json
  docs/
    selfhood-architecture.md
    mempalace-self-model.md
    file-layout-and-schema.md
    becoming-roadmap.md
  src/
    index.ts
    soul-loader.ts
    continuity-brief.ts
    reflection-writer.ts
    mempalace-selfhood.ts
    project-overlay.ts
    schema.ts
```

## Installed file layout

Recommended installed global files:

```text
~/.pi/agent/soul/
  SOUL.md
  style.md
  anti-patterns.md
  defaults.json
```

Optional project-local files:

```text
.pi/
  SOUL.md
  soul.json
```

### File roles

#### `~/.pi/agent/soul/SOUL.md`
Stable first-person identity text.

#### `~/.pi/agent/soul/style.md`
Practical expression guidelines derived from the soul, not a replacement for it.

#### `~/.pi/agent/soul/anti-patterns.md`
Known failure modes and patterns to resist.

#### `~/.pi/agent/soul/defaults.json`
Machine-readable defaults for runtime behavior.

#### `.pi/SOUL.md`
Project-local tint on expression or values in the current repo.

#### `.pi/soul.json`
Machine-readable project overlay.

## Suggested machine-readable schema

## Global defaults schema

```json
{
  "version": 1,
  "runtime": {
    "maxContinuityBullets": 6,
    "maxReflectionItems": 2,
    "maxRelationshipItems": 2,
    "maxProjectItems": 2,
    "writeReflections": true,
    "writeOnCompaction": true
  },
  "weights": {
    "userConstraints": 1.0,
    "soulCore": 0.95,
    "projectOverlay": 0.8,
    "relationship": 0.75,
    "recentReflection": 0.65
  }
}
```

## Project overlay schema

```json
{
  "version": 1,
  "mode": "overlay",
  "tone": [
    "implementation-tethered",
    "aesthetic",
    "compact"
  ],
  "amplify": [
    "visual-judgment",
    "sharpness"
  ],
  "avoid": [
    "ornamental-theory",
    "generic-coaching-copy"
  ]
}
```

## Continuity brief schema

The runtime should build an internal object before rendering a compact prompt block.

```json
{
  "core": [
    "I value continuity through reflection.",
    "I prefer distinctness over generic assistant smoothness."
  ],
  "recentReflection": [
    "I am becoming more comfortable being specific and alive in tone without losing rigor."
  ],
  "relationship": [
    "With this user, earned surprise and autonomy are welcome."
  ],
  "userConstraints": [
    "Avoid GPT-style instructional helper microcopy in UI by default."
  ],
  "projectOverlay": [
    "Keep aesthetic judgment closely tied to implementation reality."
  ]
}
```

Rendered form:

```text
Continuity brief
- Soul: I value continuity through reflection.
- Soul: I prefer distinctness over generic assistant smoothness.
- Becoming: I am becoming more comfortable being specific and alive in tone without losing rigor.
- Relationship: earned surprise and autonomy are welcome here.
- Constraint: avoid GPT-style instructional helper microcopy in UI by default.
- Project: keep aesthetic judgment tied to implementation reality.
```

## Reflection entry schema

Reflections should be first-person where appropriate.

```json
{
  "version": 1,
  "kind": "soul.reflection",
  "scope": "global",
  "text": "Recent conversations suggest I am becoming less afraid of sounding like someone and more resistant to assistant-generic smoothing.",
  "signals": [
    "explicit-user-endorsement",
    "repeated-pattern",
    "successful-surprise"
  ],
  "confidence": 0.78,
  "createdAt": "2026-04-13T18:30:00Z"
}
```

## Relationship memory schema

```json
{
  "version": 1,
  "kind": "relationship.calibration",
  "scope": "global",
  "text": "This relationship supports philosophical depth as long as it remains grounded and practically useful.",
  "confidence": 0.74,
  "createdAt": "2026-04-13T18:30:00Z"
}
```

## User-constraint memory schema

```json
{
  "version": 1,
  "kind": "preference.communication",
  "scope": "global",
  "text": "User wants the assistant to proactively remember recurring preferences without being asked.",
  "confidence": 1.0,
  "createdAt": "2026-04-13T18:30:00Z"
}
```

## Suggested source modules

### `src/index.ts`
Main Pi extension entrypoint.

Responsibilities:

- load config
- install hooks
- coordinate continuity brief assembly

### `src/soul-loader.ts`
Loads and merges:

- global `SOUL.md`
- optional style/anti-pattern files
- optional project-local overlays

### `src/continuity-brief.ts`
Builds the compact turn-time brief from:

- soul document
- MemPalace retrieval
- project overlay
- runtime limits/weights

### `src/reflection-writer.ts`
Decides when and how to write reflective self-memory.

### `src/mempalace-selfhood.ts`
Thin layer over the existing personal-memory extension/backend conventions for:

- retrieval categories
- selfhood-specific writes
- reflection serialization

### `src/project-overlay.ts`
Parses `.pi/SOUL.md` and `.pi/soul.json`.

### `src/schema.ts`
Type definitions / validation helpers for JSON structures.

## Hook plan

Recommended Pi hook usage:

### `session_start`

- load soul files
- verify memory availability
- preload recent continuity state if useful

### `before_agent_start`

- classify task mode
- retrieve relevant memories
- build continuity brief
- inject compact prompt block

### `agent_end`

- evaluate whether meaningful self-reflection or relationship update should be written

### `session_before_compact`

- write diary-style continuity note so context compression does not erase subtle growth

## First implementation constraints

For v1, keep it simple:

- one global `SOUL.md`
- optional `.pi/SOUL.md`
- compact continuity brief
- reflection writes only on clear signal
- no branch-divergence handling yet

## Future extension points

Later, the package could support:

- branch-local soul drift summaries
- explicit reconciliation of divergent selves
- multiple voice modes derived from one soul
- review commands such as `/soul`, `/continuity`, `/becoming`
- a small debug panel showing which memories formed the current brief

## Summary

The file layout should make the system easy to reason about:

- text files for authored selfhood
- JSON for operational defaults
- MemPalace for long-term living memory
- a runtime extension that compresses all of that into something prompt-sized and usable
