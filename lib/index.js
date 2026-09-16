export const name = 'dsh-session-migration-fix';
export const inject = ['sessionPersistence'];
const STRIPPED_BLOCK_KEYS = new Set([
    'thoughtSignature',
    'textSignature',
    'thinkingSignature',
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
export function apply(ctx) {
    const persistence = ctx.get('sessionPersistence');
    if (!persistence?.generationFormat?.createRestore)
        return;
    const origCreateRestore = persistence.generationFormat.createRestore.bind(persistence.generationFormat);
    persistence.generationFormat.createRestore = (header) => {
        const inner = origCreateRestore(header);
        return {
            get header() {
                return inner.header;
            },
            decodeRow(row) {
                inner.decodeRow(sanitizeHistoricalRow(row));
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
