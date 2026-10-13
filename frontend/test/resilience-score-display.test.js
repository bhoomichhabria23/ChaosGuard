import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatAvailabilityEvidence,
  formatComponentScore,
  formatResilienceScore,
  formatSuccessfulRequestEvidence,
  getScoreDisplayPercent,
} from '../src/resilience-score-display.js'

test('score display maps valid score endpoints into the visible 1-99 range', () => {
  assert.equal(formatComponentScore(0), '1.00%')
  assert.equal(formatComponentScore(100), '99.00%')
  assert.equal(formatComponentScore(87.456), '87.46%')
  assert.equal(formatResilienceScore(0), '1.00%')
  assert.equal(formatResilienceScore(100), '99.00%')
  assert.equal(formatResilienceScore(87.456), '87.46%')
  assert.equal(getScoreDisplayPercent(0), 1)
  assert.equal(getScoreDisplayPercent(100), 99)
  assert.equal(getScoreDisplayPercent(0.01), 1)
  assert.equal(getScoreDisplayPercent(99.999), 99)
})

test('missing and invalid scores use a neutral placeholder rather than a numeric score', () => {
  assert.equal(formatComponentScore(null), '—')
  assert.equal(formatResilienceScore(Number.NaN), '—')
  assert.equal(formatComponentScore(101), '—')
  assert.equal(getScoreDisplayPercent(null), null)
  assert.equal(formatAvailabilityEvidence(null), 'Pending')
  assert.equal(formatSuccessfulRequestEvidence(0, 0), 'Pending')
})

test('display formatting does not change measured experiment scores', () => {
  const experiment = {
    resilienceScore: 100,
    scoreBreakdown: { availability: 0, performance: 100 },
  }
  formatResilienceScore(experiment.resilienceScore)
  formatComponentScore(experiment.scoreBreakdown.availability)
  formatComponentScore(experiment.scoreBreakdown.performance)
  assert.equal(experiment.resilienceScore, 100)
  assert.deepEqual(experiment.scoreBreakdown, { availability: 0, performance: 100 })
})

test('boundary availability and request evidence are described without fake scores', () => {
  assert.equal(formatAvailabilityEvidence(0), 'No health checks succeeded')
  assert.equal(formatAvailabilityEvidence(100), 'All health checks succeeded')
  assert.equal(formatAvailabilityEvidence(0.001), 'Very few health checks succeeded')
  assert.equal(formatAvailabilityEvidence(99.999), 'Nearly all health checks succeeded')
  assert.equal(formatSuccessfulRequestEvidence(0, 12), 'No requests succeeded (12 observed)')
  assert.equal(formatSuccessfulRequestEvidence(12, 12), '12 of 12 requests succeeded')
})
