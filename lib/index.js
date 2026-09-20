export const name = 'dsh-session-migration-fix';
export const inject = ['sessionPersistence'];
const STRIPPED_BLOCK_KEYS = new Set([
    'thoughtSignature',
    'textSignature',
    'thinkingSignature',
]);
const KNOWN_V0_EVENT_TYPES = new Set([
    'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
    'approval/policy', 'assistant/chunk', 'assistant/message', 'command/done', 'command/run',
    'compaction/end', 'compaction/prune', 'compaction/start', 'compaction/summary',
    'feedback/record', 'goal/change', 'hook/invoked', 'hook/result', 'llm/retry',
    'llm/retry-started', 'model/selection', 'permission/preset', 'plan/mode',
    'request/context', 'request/header', 'sandbox/mode', 'schedule/change',
    'session-log-deepseek/delivery-accepted', 'session/end-seed', 'session/title',
    'session/title-llm-request', 'step/end', 'step/start', 'subagent/descriptor',
    'subagent/model-selection-policy', 'team/member', 'team/message/delivered',
    'team/message/queued', 'team/task', 'todo/write', 'tool-workflow/agent-end',
    'tool-workflow/agent-start', 'tool-workflow/run-end', 'tool-workflow/run-start',
    'tool/call', 'tool/code-dispatch', 'tool/code-dispatch-start', 'tool/result',
    'turn/end', 'turn/start', 'user/message', 'web/deepseek-search-llm-request',
    'session', 'text-chunks', 'reasoning-chunks', 'tool-call-chunks',
    'steering/message', 'request/header-delta', 'mode/set', 'compact/start',
    'compact/summary', 'compact/end', 'compact/prune',
]);
/**
 * Sanitize historical session rows before format validation/migration.
 * Strips unexpected signature keys that leaked into tool-call, reasoning,
 * or text blocks and chunks, while preserving opaque replayState records intact.
 */
export function sanitizeHistoricalRow(value) {
    if (value == null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(sanitizeHistoricalRow);
    const record = value;
    const result = {};
    for (const [key, val] of Object.entries(record)) {
        if (key === 'replayState') {
            result[key] = val;
            continue;
        }
        if (STRIPPED_BLOCK_KEYS.has(key)) {
            continue;
        }
        result[key] = sanitizeHistoricalRow(val);
    }
    return result;
}
/**
 * Normalize historical v0 rows so that unknown event types (such as third-party plugin
 * events like orchestrate/change) are mapped to a harmless released v0 event (feedback/record),
 * preventing migration refusal while keeping sequence density intact.
 */
export function normalizeHistoricalV0Row(row) {
    const sanitized = sanitizeHistoricalRow(row);
    if (sanitized && typeof sanitized === 'object' && typeof sanitized.type === 'string') {
        const record = sanitized;
        const type = record.type;
        if (!KNOWN_V0_EVENT_TYPES.has(type)) {
            return {
                type: 'feedback/record',
                seq: record.seq,
                time: record.time ?? 0,
                data: {
                    text: `[migrated:${type}] ${JSON.stringify(record.data ?? {})}`,
                },
            };
        }
    }
    return sanitized;
}
export function apply(ctx) {
    const persistence = ctx.get('sessionPersistence');
    if (!persistence?.generationFormat?.createRestore)
        return;
    const origCreateRestore = persistence.generationFormat.createRestore.bind(persistence.generationFormat);
    persistence.generationFormat.createRestore = (header) => {
        const inner = origCreateRestore(header);
        const isV0 = header && typeof header === 'object' && header.version === 0;
        return {
            get header() {
                return inner.header;
            },
            decodeRow(row) {
                inner.decodeRow(isV0 ? normalizeHistoricalV0Row(row) : sanitizeHistoricalRow(row));
            },
            finish() {
                return inner.finish();
            },
        };
    };
    ctx.effect(() => {
        return () => {
            persistence.generationFormat.createRestore = origCreateRestore;
        };
    }, 'dsh-session-migration-fix restore hook');
}
