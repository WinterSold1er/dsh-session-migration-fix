import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-session-migration-fix";
export declare const inject: string[];
/**
 * Sanitize historical session rows before format validation/migration.
 * Strips unexpected signature keys that leaked into tool-call, reasoning,
 * or text blocks and chunks, while preserving opaque replayState records intact.
 */
export declare function sanitizeHistoricalRow(value: unknown): unknown;
export declare function apply(ctx: Context): void;
