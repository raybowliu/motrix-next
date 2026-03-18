/** @fileoverview TDD tests for magnet poll restart logic.
 *
 * Verifies the contract: after a magnet file selection dialog is confirmed
 * or cancelled, the polling loop must restart if there are remaining
 * pending magnet GIDs awaiting metadata resolution.
 *
 * The shouldRestartMagnetPoll function was extracted to make this
 * orchestration decision independently testable from the Vue component.
 */
import { describe, it, expect } from 'vitest'

const { shouldRestartMagnetPoll } = await import('@/composables/useMagnetFlow')

describe('shouldRestartMagnetPoll', () => {
  it('returns true when there are remaining pending GIDs', () => {
    expect(shouldRestartMagnetPoll(['gid-2', 'gid-3'])).toBe(true)
  })

  it('returns true when there is exactly one remaining GID', () => {
    expect(shouldRestartMagnetPoll(['gid-1'])).toBe(true)
  })

  it('returns false when no pending GIDs remain', () => {
    expect(shouldRestartMagnetPoll([])).toBe(false)
  })

  it('returns false for an empty-like state (all GIDs already processed)', () => {
    const gids: string[] = []
    expect(shouldRestartMagnetPoll(gids)).toBe(false)
  })
})
