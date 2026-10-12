import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpTrafficProbe } from '../http-traffic-probe.mjs'

test('opt-in probe records only actual response statuses and delivery failures', async () => {
  let callCount = 0
  const probe = createHttpTrafficProbe(
    async () => {
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

  assert.deepEqual(measurement, {
    enabled: true,
    intervalMs: 1,
    attempts: 3,
    completedResponses: 2,
    deliveryFailures: 1,
    statusClassCounts: {
      '1xx': 0,
      '2xx': 1,
      '3xx': 0,
      '4xx': 0,
      '5xx': 1,
    },
  })
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
