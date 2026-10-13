import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHttpErrorRateQueries,
  createErrorRateMeasurement,
} from '../prometheus-observations.mjs'

test('PromQL uses reset-aware increases and the exact experiment window', () => {
  const queries = buildHttpErrorRateQueries('user-service', 12500)
  assert.match(queries.totalRequests, /increase\(chaosguard_http_requests_total/)
  assert.match(queries.failedRequests, /increase\(chaosguard_http_server_errors_total/)
  assert.match(queries.clientErrorRequests, /increase\(chaosguard_http_client_errors_total/)
  assert.match(queries.totalRequests, /\[12500ms\]/)
  assert.match(queries.sampleCount, /count_over_time/)
  assert.match(queries.scrapeCoverage, /\[2000ms\]/)
  assert.throws(() => buildHttpErrorRateQueries('unknown-service', 5000))
  assert.throws(() => buildHttpErrorRateQueries('user-service', 0))
})

test('error rate uses actual request counts, reports 4xx separately, and excludes no traffic', () => {
  const measured = createErrorRateMeasurement({
    target: 'user-service',
    windowStart: '2026-10-09T10:00:00.000Z',
    windowEnd: '2026-10-09T10:00:10.000Z',
    sampleCount: 3,
    totalRequests: 20,
    failedRequests: 2,
    clientErrorRequests: 4,
    monitoringCoveragePercent: 100,
  })
  assert.equal(measured.status, 'measured')
  assert.equal(measured.errorRatePercent, 10)
  assert.equal(measured.totalRequests, 20)
  assert.equal(measured.failedRequests, 2)
  assert.equal(measured.clientErrorRequests, 4)
  assert.equal(measured.successfulRequests, 14)

  const noTraffic = createErrorRateMeasurement({
    target: 'user-service',
    windowStart: '2026-10-09T10:00:00.000Z',
    windowEnd: '2026-10-09T10:00:10.000Z',
    sampleCount: 3,
    totalRequests: 0,
    failedRequests: 0,
    clientErrorRequests: 0,
    monitoringCoveragePercent: 100,
  })
  assert.equal(noTraffic.status, 'no-traffic')
  assert.equal(noTraffic.errorRatePercent, null)
  assert.equal(noTraffic.successfulRequests, null)
  assert.match(noTraffic.reason, /No HTTP requests/)
})

test('error rate marks missing samples and inconsistent counts unavailable', () => {
  const insufficient = createErrorRateMeasurement({
    target: 'order-service',
    windowStart: '2026-10-09T10:00:00.000Z',
    windowEnd: '2026-10-09T10:00:03.000Z',
    sampleCount: 1,
    totalRequests: 0,
    failedRequests: 0,
    clientErrorRequests: 0,
    monitoringCoveragePercent: 100,
  })
  assert.equal(insufficient.status, 'insufficient-samples')
  assert.equal(insufficient.errorRatePercent, null)

  const inconsistent = createErrorRateMeasurement({
    target: 'order-service',
    windowStart: '2026-10-09T10:00:00.000Z',
    windowEnd: '2026-10-09T10:00:03.000Z',
    sampleCount: 2,
    totalRequests: 1,
    failedRequests: 2,
    clientErrorRequests: 0,
    monitoringCoveragePercent: 100,
  })
  assert.equal(inconsistent.status, 'inconsistent-data')
  assert.equal(inconsistent.errorRatePercent, null)

  const stale = createErrorRateMeasurement({
    target: 'order-service',
    windowStart: '2026-10-09T10:00:00.000Z',
    windowEnd: '2026-10-09T10:00:20.000Z',
    sampleCount: 2,
    totalRequests: 4,
    failedRequests: 0,
    clientErrorRequests: 0,
    monitoringCoveragePercent: 45,
  })
  assert.equal(stale.status, 'insufficient-coverage')
  assert.equal(stale.errorRatePercent, null)
  assert.equal(stale.totalRequests, null)
})
