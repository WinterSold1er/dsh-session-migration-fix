import assert from 'node:assert/strict'
import { Context } from '/home/csy/Code/installer/deepseek-harness/vendor/cordis/lib/index.js'
import JsonlSessionPersistence from '/home/csy/Code/installer/deepseek-harness/packages/session/session-persistence-jsonl/lib/index.js'
import { SessionId } from '/home/csy/Code/installer/deepseek-harness/packages/core/session/lib/index.js'
import * as plugin from '../lib/index.js'

console.log('--- Running Unit Tests for sanitizeHistoricalRow ---')

// 1. Tool call block with thoughtSignature
const rawToolCallBlock = {
  type: 'tool-call',
  id: 'call_123',
  name: 'bash',
  arguments: '{"cmd":"ls"}',
  thoughtSignature: 'sig123',
}
const sanitizedToolCall = plugin.sanitizeHistoricalRow(rawToolCallBlock) as Record<string, unknown>
assert.equal(sanitizedToolCall['type'], 'tool-call')
assert.equal(sanitizedToolCall['id'], 'call_123')
assert.equal(sanitizedToolCall['name'], 'bash')
assert.equal(sanitizedToolCall['arguments'], '{"cmd":"ls"}')
assert.equal(sanitizedToolCall['thoughtSignature'], undefined)
console.log('✓ Strips thoughtSignature from tool-call block')

// 2. Text block with textSignature and reasoning with thinkingSignature
const rawTextBlock = {
  type: 'text',
  text: 'hello',
  textSignature: 'text_sig',
}
const rawReasoningBlock = {
  type: 'reasoning',
  text: 'thinking...',
  thinkingSignature: 'think_sig',
}
assert.equal((plugin.sanitizeHistoricalRow(rawTextBlock) as any).textSignature, undefined)
assert.equal((plugin.sanitizeHistoricalRow(rawReasoningBlock) as any).thinkingSignature, undefined)
console.log('✓ Strips textSignature and thinkingSignature from text/reasoning blocks')

// 3. replayState preserved intact
const rawMessageWithReplay = {
  role: 'assistant',
  content: [rawToolCallBlock],
  source: {
    kind: 'model',
    provider: 'antigravity',
    model: 'gemini-3.8-flash',
    replayState: {
      blocks: [
        { type: 'tool-call', thoughtSignature: 'keep_this_sig' },
      ],
    },
  },
}
const sanitizedMessage = plugin.sanitizeHistoricalRow(rawMessageWithReplay) as any
assert.equal(sanitizedMessage.content[0].thoughtSignature, undefined)
assert.equal(sanitizedMessage.source.replayState.blocks[0].thoughtSignature, 'keep_this_sig')
console.log('✓ Preserves replayState intact while stripping leaked content block signatures')

// 4. Chunks (block-end and tool-call-delta)
const rawDeltaChunk = {
  type: 'tool-call-delta',
  index: 0,
  id: 'call_1',
  argumentsDelta: '{}',
  thoughtSignature: 'delta_sig',
}
const rawBlockEndChunk = {
  type: 'block-end',
  index: 0,
  block: rawToolCallBlock,
}
assert.equal((plugin.sanitizeHistoricalRow(rawDeltaChunk) as any).thoughtSignature, undefined)
assert.equal((plugin.sanitizeHistoricalRow(rawBlockEndChunk) as any).block.thoughtSignature, undefined)
console.log('✓ Strips signatures from chunk objects and chunk block records')

// 5. Unknown v0 event normalization (e.g. orchestrate/change)
console.log('--- Running Unit Tests for normalizeHistoricalV0Row ---')
const rawOrchestrate = {
  type: 'orchestrate/change',
  seq: 2900,
  time: 1789208680431,
  data: { mode: 'on' },
}
const normalizedOrchestrate = plugin.normalizeHistoricalV0Row(rawOrchestrate) as any
assert.equal(normalizedOrchestrate.type, 'feedback/record')
assert.equal(normalizedOrchestrate.seq, 2900)
assert.equal(normalizedOrchestrate.time, 1789208680431)
assert.equal(normalizedOrchestrate.data.text, '[migrated:orchestrate/change] {"mode":"on"}')
console.log('✓ Normalizes unknown orchestrate/change event to feedback/record')

const rawKnownEvent = {
  type: 'turn/start',
  seq: 1,
  time: 100,
  data: { turn: 1 },
}
const normalizedKnown = plugin.normalizeHistoricalV0Row(rawKnownEvent) as any
assert.equal(normalizedKnown.type, 'turn/start')
assert.equal(normalizedKnown.seq, 1)
console.log('✓ Preserves known v0 event unchanged')

console.log('--- Running Integration Tests with Cordis & JsonlSessionPersistence ---')

async function runIntegrationTest() {
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, {
    root: '/home/csy/.dsh/sessions',
    compression: 'zstd',
  })

  // Apply our plugin
  const fiber = await ctx.plugin(plugin)

  const persistence = ctx.get('sessionPersistence') as any
  assert.ok(persistence, 'sessionPersistence must be mounted')

  // Test 1: session-0b708a0c (thoughtSignature)
  const targetId1 = SessionId('session-0b708a0c-0396-4636-9db3-fe22e8b359c9')
  const handle1 = await persistence.open(targetId1, 'read')
  const readResult1 = await handle1.read(0)
  assert.equal(readResult1.events.length, 809, 'Should read all 809 events from historical session')
  await handle1.close()
  console.log(`✓ Successfully migrated and opened session-0b708a0c (${readResult1.events.length} events)`)

  // Test 2: session-697fb9f3 (orchestrate/change + thoughtSignature)
  const targetId2 = SessionId('session-697fb9f3-2fba-49a5-b013-63ac1c0baf5e')
  const handle2 = await persistence.open(targetId2, 'read')
  const readResult2 = await handle2.read(0)
  assert.equal(readResult2.events.length, 1100, 'Should read all 1100 events from historical session')
  await handle2.close()
  console.log(`✓ Successfully migrated and opened session-697fb9f3 (${readResult2.events.length} events)`)

  // Test disposal / HMR
  fiber.dispose()
  console.log('✓ Plugin disposed cleanly')

  console.log('ALL TESTS PASSED!')
}

runIntegrationTest().catch((err) => {
  console.error('Integration test failed:', err)
  process.exit(1)
})
