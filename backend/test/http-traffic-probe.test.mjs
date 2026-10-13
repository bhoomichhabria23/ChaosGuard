import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createHttpTrafficProbe,
  measureHttpResponseBaseline,
} from '../http-traffic-probe.mjs'

test('opt-in probe records only actual response statuses and delivery failures', async () => {
  let callCount = 0
  const probe = createHttpTrafficProbe(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 2))
      callCount += 1
      if (callCount === 1) return 200
      if (callCount === 2) return 503
      throw new Error('request unavailable')
    },
    { intervalMs: 1 },
  )

  while (callCount < 3) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const measurement = await probe.stop()

  assert.equal(measurement.enabled, true)
  assert.equal(measurement.intervalMs, 1)
  assert.equal(measurement.attempts, 3)
  assert.equal(measurement.completedResponses, 2)
  assert.equal(measurement.deliveryFailures, 1)
  assert.deepEqual(measurement.statusClassCounts, {
      '1xx': 0,
      '2xx': 1,
      '3xx': 0,
      '4xx': 0,
      '5xx': 1,
  })
  assert.equal(measurement.responseTimeSamplesMs.length, 2)
  assert.ok(measurement.responseTimeSamplesMs.every((duration) => duration > 0))
  assert.equal(measurement.responseSamples.length, 3)
  assert.deepEqual(
    measurement.responseSamples.map((sample) => sample.statusCode),
    [200, 503, null],
  )
  assert.ok(
    measurement.responseSamples.every((sample) => Date.parse(sample.recordedAt)),
  )
  assert.equal(measurement.responseSamples[2].requestFailed, true)
  assert.ok(measurement.averageResponseTimeMs > 0)
})

test('probe validates the request function and interval', () => {
  assert.throws(
    () => createHttpTrafficProbe(null),
    /request must be a function/,
  )
  assert.throws(
    () => createHttpTrafficProbe(async () => 200, { intervalMs: 0 }),
    /interval must be a positive integer/,
  )
})

test('baseline response measurement records real response times and outcomes', async () => {
  const statuses = [200, 503, 404]
  const result = await measureHttpResponseBaseline(
    async () => statuses.shift(),
  )

  assert.equal(result.status, 'measured')
  assert.equal(result.sampleCount, 3)
  assert.equal(result.totalRequests, 3)
  assert.equal(result.successfulRequests, 1)
  assert.equal(result.errorRatePercent, 66.67)
  assert.equal(result.statusClassCounts['2xx'], 1)
  assert.equal(result.statusClassCounts['4xx'], 1)
  assert.equal(result.statusClassCounts['5xx'], 1)
  assert.ok(result.responseTimeMs > 0)
})

test('baseline does not claim a response-time measurement when every request fails', async () => {
  const result = await measureHttpResponseBaseline(async () => {
    throw new Error('service unavailable')
  })

  assert.equal(result.status, 'unavailable')
  assert.equal(result.responseTimeMs, null)
  assert.match(result.reason, /service unavailable/)
})
