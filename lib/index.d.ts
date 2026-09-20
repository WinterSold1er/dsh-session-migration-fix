import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-session-migration-fix";
export declare const inject: string[];
/**
 * Sanitize historical session rows before format validation/migration.
 * Strips unexpected signature keys that leaked into tool-call, reasoning,
 * or text blocks and chunks, while preserving opaque replayState records intact.
 */
export declare function sanitizeHistoricalRow(value: unknown): unknown;
/**
 * Normalize historical v0 rows so that unknown event types (such as third-party plugin
 * events like orchestrate/change) are mapped to a harmless released v0 event (feedback/record),
 * preventing migration refusal while keeping sequence density intact.
 */
export declare function normalizeHistoricalV0Row(row: unknown): unknown;
export declare function apply(ctx: Context): void;
