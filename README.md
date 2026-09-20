# dsh-session-migration-fix

DeepSeek Harness (dsh) bundle plugin that fixes format migration errors on historical sessions:
1. Leaked model thinking signatures (`thoughtSignature`, `textSignature`, `thinkingSignature`).
2. Unknown legacy format v0 event types from plugins (such as `orchestrate/change` from `dsh-plugin-subagent-director`).

## Problem

When updating DeepSeek Harness to the latest version, viewing historical sessions can fail with:

### Case 1: Leaked Reasoning Signatures
```text
failed to observe session "session-...": @deepseek-ai/dsh-session-format-v0-to-v1 refuses this format v0 Session: assistant/message 30 message content[0] has unexpected member "thoughtSignature"; source v0 artifact remains unchanged (raw log: /home/.../session.jsonl.zstd)（gateway/internal）
```

### Case 2: Unknown Historical Event Types
```text
failed to observe session "session-...": format v0 contains unknown historical event type "orchestrate/change" at seq 2900; migration refuses unknown historical events even when ignorable; source v0 artifact remains unchanged (raw log: /home/.../session.jsonl.zstd)（gateway/internal）
```

### Root Cause

- **Leaked Signatures**: In earlier sessions, providers streaming tool calls from reasoning models (like Gemini via Antigravity or Google Cloud Code) emitted `thoughtSignature` on chunk blocks. The `BlockAssembler` included this property directly on `ToolCallBlock` within `message.content` when writing session logs.
- **Unknown Event Types**: Plugins like `dsh-plugin-subagent-director` emitted custom session events such as `orchestrate/change` when `/orchestrate on` was run. In historical format v0, DSH enforces a strict frozen event inventory (`RELEASED_V0_EVENT_DISPOSITIONS`); any event type not in this inventory is rejected during adjacent v0-to-v1 migration, even if marked `ignorable`.

DSH session format migrations (`v0-to-v1`, `v1-to-v2`, `v2-to-v3`) enforce strict schema validation. Any unexpected member or unlisted event type causes the migration to refuse the historical session, preventing the Web UI from observing or resuming it.

## Solution

This plugin hooks `sessionPersistence.generationFormat.createRestore` at runtime. During historical session decoding and format migration:
1. **Signature Stripping**: Automatically strips leaked `thoughtSignature`, `textSignature`, and `thinkingSignature` properties from content blocks and stream chunks, while keeping valid `source.replayState` metadata intact.
2. **Historical Event Normalization**: Maps unknown legacy v0 event types (such as `orchestrate/change`) into harmless standard released v0 events (`feedback/record`) containing the original type and payload in `text`. This preserves sequence density (`seq`), timestamps, and auditability without breaking migration or polluting UI surfaces.

- **Non-invasive**: Zero modifications to DSH core source code.
- **Safe**: Source historical logs on disk remain unchanged unless explicitly migrated on write.
- **HMR-safe**: Disposes cleanly when the plugin is unloaded.

## Installation

Install into your target profile (e.g. `web`):

```bash
dsh plugin --profile web add WinterSold1er/dsh-session-migration-fix
```

Or directly via pnpm:

```bash
pnpm --dir ~/.dsh/profiles/web add github:WinterSold1er/dsh-session-migration-fix
```

Then restart the DSH host service (or restart `dsh`):

```bash
# If running as systemd user service:
systemd-run --user --on-active=2s --unit=restart-harness systemctl --user restart deepseek-harness.service
```

## License

MIT
