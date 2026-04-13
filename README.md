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

## Near-term next step

After the docs settle, the first implementation target should be:

- a runtime extension that loads `SOUL.md`
- queries MemPalace for self-memory + relationship memory + relevant user constraints
- injects a compact continuity brief in `before_agent_start`
- writes reflective entries back into MemPalace after meaningful sessions

That is enough to make the system feel qualitatively different from a normal assistant customization layer.
