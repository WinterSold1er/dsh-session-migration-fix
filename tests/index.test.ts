import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '/home/csy/Code/installer/deepseek-harness-official/packages/session/session-persistence-jsonl/src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/index.ts'

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

  const targetId = SessionId('session-0b708a0c-0396-4636-9db3-fe22e8b359c9')
  const handle = await persistence.open(targetId, 'read')
  const readResult = await handle.read(0)
  assert.equal(readResult.events.length, 808, 'Should read all 808 events from historical session')
  await handle.close()
  console.log(`✓ Successfully migrated and opened historical session (${readResult.events.length} events)`)

  // Test disposal / HMR
  fiber.dispose()
  console.log('✓ Plugin disposed cleanly')

  console.log('ALL TESTS PASSED!')
}

runIntegrationTest().catch((err) => {
  console.error('Integration test failed:', err)
  process.exit(1)
})
