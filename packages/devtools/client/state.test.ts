import { describe, expect, it } from 'vitest'
import { parseEditable, parseParameters, planNodes, WorkspaceState } from './state'

describe('devtools panel state', () => {
  it('isolates database state and rejects stale requests', () => {
    const state = new WorkspaceState()
    state.select('runtime-a', 'one')
    state.current.sql = 'select 1'
    const ticket = state.begin('table')
    state.select('runtime-a', 'two')
    expect(state.accepts(ticket)).toBe(false)
    expect(state.current.sql).toContain('SELECT name')
    state.select('runtime-a', 'one')
    expect(state.current.sql).toBe('select 1')
  })

  it('keeps only the most recent fifty history entries', () => {
    const state = new WorkspaceState()
    state.select('runtime-a', 'one')
    for (let index = 0; index < 55; index++) { state.record(state.current, { sql: `select ${index}`, parameters: '[]', kind: 'query', status: 'success', elapsedMs: index, summary: 'ok' }) }
    expect(state.current.history).toHaveLength(50)
    expect(state.current.history[0]?.sql).toBe('select 54')
  })

  it('decodes bigint and blob parameter forms', () => {
    const value = parseEditable('{"id":{"$bigint":"9007199254740993"},"data":{"$blob":[0,255]}}') as Record<string, unknown>
    expect(value['id']).toBe(9007199254740993n)
    expect(value['data']).toEqual(new Uint8Array([0, 255]))
    expect(parseParameters('[1, null, "ok"]')).toEqual([1, null, 'ok'])
    expect(() => parseParameters('[{"invalid":true}]')).toThrow()
  })

  it('builds an execution plan tree without hanging on cycles', () => {
    expect(planNodes([
      { id: 0, parent: 0, detail: 'SCAN users' },
      { id: 1, parent: 0, detail: 'SEARCH posts USING INDEX posts_user' },
      { id: 2, parent: 99, detail: 'CYCLE' },
    ])).toEqual([
      { id: 0, parent: 0, detail: 'SCAN users', depth: 0 },
      { id: 1, parent: 0, detail: 'SEARCH posts USING INDEX posts_user', depth: 1 },
      { id: 2, parent: 99, detail: 'CYCLE', depth: 0 },
    ])
  })
})
