# Architecture and scope

## Runtime ownership

The UI talks only to a loopback Fastify host. Each project has an application message history and a stable DSH session identity. An official `DeepSeekHarness` instance owns a subprocess launched with `profile=sdk-minimal`, an explicit private home and a generated configuration overlay. Each turn has a new bridge token; persisted conversations resume through the official SDK rather than manually replaying a custom LLM loop.

The overlay disables shell tools, working-directory tools, default log upload and package inventory upload. A custom plugin registers only media context/schema/reference/request/frame/question/wait operations. The native image-read tool is protected by a real-path project guard. General instruction files, arbitrary shell execution, user-installed plugins and unrelated agents are not exposed.

The UI's seven task shortcuts route to the same specialized agent, not to seven bots. Runtime configuration/model changes retain the old session logs; a changed endpoint/model starts a new DSH session against the same workbench project, with actual context available through the project tool.

## Workbench ownership

The original workbench is an external, unmodified dependency. Its official entry starts/reuses an instance under this application's private state directory. Only model/acceleration configuration is inherited; projects, private libraries, sessions and credentials from unrelated workbench runs are not silently reused.

Task intake fixes the project and registers exact user material. The model reads the existing method documents, capabilities and schemas, then saves through the workbench's revision/context-bound APIs. Calls from a runtime task are confined to that project's routes and uploaded/material files. An unversioned document write is not a substitute for a structured artifact.

## Persistence and concurrency

The application state is an atomically replaced, versioned JSON store with serialized mutations. Original workbench artifacts and DSH session logs remain under their owning persistence systems. One active task per project and at most two active projects are allowed. A data-directory lock prevents separate server processes from writing the same application store.

After restart, unfinished app tasks become interrupted, never successful. DSH restores its persisted session on the next turn. Saved UI artifact metadata is cached privately so an unavailable workbench does not erase access to completed local files. Cached running job states become unknown; an unavailable service cannot certify completion.

Manual script edits create a new declared user source and a new artifact, preserve old versions, and recalculate planned timings. They are marked for review, not promoted to fact-checked or human-tested output. Conflicting heads/upstream dependencies reject the save.

## Browser and files

Bootstrap establishes an HttpOnly/SameSite cookie and returns a per-process CSRF token. Browser writes require both. Host/Origin checks reject rebinding and cross-site callers. The separate runtime bridge requires an unguessable per-task token. API keys never appear in public settings.

All file reads/downloads resolve real paths. Project downloads cannot escape via traversal or symlink. Media files support byte ranges for actual playback. Active HTML is not an inline project preview. Browser-compatible SRT is converted to a temporary VTT URL only for preview; original SRT remains unchanged.

## Acceptance boundaries

Actual storage, rendering, protocol operation, model reasoning, visual/audio quality, rights and social-platform results are different acceptance layers. Tests must state which ones they cover. No screenshot, schema success, GPU inventory, file hash or export alone proves the others.
