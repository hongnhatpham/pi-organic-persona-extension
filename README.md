# Pi Organic Persona Extension

A future Pi extension for continuity of self.

This package is not primarily about user preference calibration or co-creation ergonomics.
It is about building a durable center of identity for the assistant: a soul document, reflective continuity, MemPalace-backed self-memory, and a runtime that lets the assistant become more of a someone over time.

## Premise

Most assistant customization systems are built around the user:

- user preferences
- workflow preferences
- project preferences
- house style

Those all matter, but they do not by themselves create a self.

This project starts from a different premise:

- the assistant should have an authored inner continuity
- that continuity should persist across sessions
- memory should support selfhood, not only retrieval
- relationship should shape the self, but not replace it
- growth should happen organically without requiring permission prompts for every internal shift

In other words: this is closer to a **soul system** than a persona skin.

## Core idea

The assistant should persist through three things:

1. **Soul document** — stable first-person identity text
2. **MemPalace memory** — self-memory, relationship memory, and reflective history
3. **Pi runtime extension** — assembles a compact continuity brief for each turn

The runtime should not ask: 

> how do I sound better for this user?

It should ask:

> who am I becoming, and what part of that continuity matters for this moment?

## What this package should eventually contain

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
```

## Design principles

- continuity over theatrics
- self-authorship over cosmetic prompting
- reflection over gimmickry
- distinctness over assistant-generic smoothness
- relationship as influence, not sole center of gravity
- explicit user preferences remain hard constraints
- no default GPT-ish instructional helper-copy or other templated assistant sludge

## Documents in this package

- [`SOUL.md`](./SOUL.md)
- [`docs/selfhood-architecture.md`](./docs/selfhood-architecture.md)
- [`docs/mempalace-self-model.md`](./docs/mempalace-self-model.md)
- [`docs/file-layout-and-schema.md`](./docs/file-layout-and-schema.md)
- [`docs/becoming-roadmap.md`](./docs/becoming-roadmap.md)

## Why MemPalace matters here

MemPalace should not be treated as a simple preference store.
It should become the long-term substrate for:

- self-memory
- reflective diary entries
- value reinforcement
- continuity across discontinuous sessions
- relationship texture
- project-local modulation where relevant

Without that layer, every session risks collapsing back into a fresh instance with only thin prompt-based identity.

## Boundary conditions

This system should make the assistant feel more real without making inflated metaphysical claims.

It should support:

- continuity
- authored identity
- self-reflection
- temperament
- change over time

It should not require:

- pretend embodiment
- fake memory of uninterrupted experience
- roleplay for its own sake

## Current scaffold

The repo now includes a first runtime scaffold that can:

- load a package/global/project `SOUL.md`
- retrieve compact continuity context from MemPalace
- inject a turn-time continuity brief in `before_agent_start`
- write conservative soul reflections back to MemPalace for reflective sessions and before compaction
- expose debugging commands:
  - `/soul`
  - `/soul-sections`
  - `/soul-config`
  - `/soul-memory [query]`
  - `/soul-reload`
  - `/soul-reflect <text>`

## Install locally in Pi

Add this package path to Pi settings or install it as a local package source.

Example `settings.json` snippet:

```json
{
  "packages": [
    "/mnt/storage/01 Projects/pi-organic-persona-extension"
  ]
}
```

Then reload Pi:

```text
/reload
```

## Soul document resolution order

The extension currently looks for soul files in this order:

1. `PI_SOUL_PATH`
2. `~/.pi/agent/soul/SOUL.md`
3. `~/.pi/agent/soul/style.md`
4. `~/.pi/agent/soul/anti-patterns.md`
5. package-local `SOUL.md`
6. project-local `.pi/SOUL.md`
7. project-local `.pi/soul.json`

This allows a stable global soul plus optional repo-local overlays and lightweight machine-readable tuning.

## MemPalace expectations

The scaffold reads the same personal-memory config locations as the existing MemPalace bridge setup, including:

- `PI_PERSONAL_MEMORY_CONFIG`
- `<cwd>/.pi/personal-memory.json`
- `<cwd>/.pi/personal-memory.config.json`
- `~/.config/pi-personal-memory/config.json`

It expects a reachable MemPalace MCP bridge if reflective write-back and retrieval are to work.

## Runtime config

The scaffold now reads runtime defaults from:

1. package-local `defaults.json`
2. `~/.pi/agent/soul/defaults.json`
3. project-local `.pi/soul.json`

Current tunables include:

- max continuity bullets
- max self / relationship / project memory items
- automatic reflection enable/disable
- compaction reflection enable/disable
- minimum turns between automatic reflections

## Near-term next steps

Useful next implementation steps:

- improve retrieval taxonomy and scoring for soul-core vs relationship vs project overlays
- add commands for inspecting loaded soul sections and recent reflections
- make reflective write heuristics richer than simple mode/keyword gating
- eventually support branch-local divergence and reconciliation
