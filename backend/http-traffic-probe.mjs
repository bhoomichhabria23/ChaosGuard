import { performance } from 'node:perf_hooks'

const statusClasses = ['1xx', '2xx', '3xx', '4xx', '5xx']

export async function measureHttpResponseBaseline(
  request,
  { sampleCount = 3 } = {},
) {
  if (typeof request !== 'function') {
    throw new TypeError('Baseline request must be a function')
  }
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('Baseline sample count must be a positive integer')
  }

  const samples = []
  const failures = []
  const statusCounts = Object.fromEntries(
    statusClasses.map((statusClass) => [statusClass, 0]),
  )
  for (let index = 0; index < sampleCount; index += 1) {
    const startedAt = performance.now()
    try {
      const statusCode = await request()
      const responseTimeMs = performance.now() - startedAt
      if (
        !Number.isInteger(statusCode) ||
        statusCode < 100 ||
        statusCode > 599 ||
        !Number.isFinite(responseTimeMs) ||
        responseTimeMs <= 0
      ) {
        failures.push(`Baseline returned unusable HTTP status ${statusCode}.`)
      } else {
        samples.push(responseTimeMs)
        statusCounts[`${Math.floor(statusCode / 100)}xx`] += 1
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (samples.length === 0) {
    return {
      status: 'unavailable',
      source: 'kubernetes-service-proxy-http-probe',
      sampleCount: 0,
      responseTimeMs: null,
      totalRequests: 0,
      successfulRequests: 0,
      statusClassCounts: statusCounts,
      reason: failures.join(' ') || 'No valid baseline response was recorded.',
    }
  }

  return {
    status: 'measured',
    source: 'kubernetes-service-proxy-http-probe',
    sampleCount: samples.length,
    responseTimeMs:
      samples.reduce((total, sample) => total + sample, 0) / samples.length,
    totalRequests: samples.length,
    successfulRequests: statusCounts['2xx'] + statusCounts['3xx'],
    errorRatePercent:
      samples.length > 0
        ? Math.round(
            ((statusCounts['4xx'] + statusCounts['5xx']) / samples.length) *
              10000,
          ) / 100
        : null,
    statusClassCounts: statusCounts,
    samplesMs: samples,
    reason: null,
  }
}

export function createHttpTrafficProbe(
  request,
  { intervalMs = 1000 } = {},
) {
  if (typeof request !== 'function') {
    throw new TypeError('Traffic probe request must be a function')
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new RangeError('Traffic probe interval must be a positive integer')
  }

  let stopped = false
  let timer = null
  let attempts = 0
  let completedResponses = 0
  let deliveryFailures = 0
  let inFlight = Promise.resolve()
  const responseTimesMs = []
  const responseSamples = []
  const statusClassCounts = Object.fromEntries(
    statusClasses.map((statusClass) => [statusClass, 0]),
  )

  const sendRequest = async () => {
    attempts += 1
    const startedAt = performance.now()
    try {
      const statusCode = await request()
      if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
        throw new Error('Traffic probe received an invalid HTTP status')
      }
      const recordedAt = new Date().toISOString()
      completedResponses += 1
      statusClassCounts[`${Math.floor(statusCode / 100)}xx`] += 1
      const responseTimeMs = performance.now() - startedAt
      responseTimesMs.push(responseTimeMs)
      responseSamples.push({
        statusCode,
        responseTimeMs,
        recordedAt,
      })
    } catch (error) {
      deliveryFailures += 1
      responseSamples.push({
        statusCode: null,
        responseTimeMs: null,
        requestFailed: true,
        recordedAt: new Date().toISOString(),
      })
      console.error('Opt-in HTTP traffic probe request failed:', error)
    }

    if (!stopped) {
      timer = setTimeout(() => {
        inFlight = sendRequest()
      }, intervalMs)
    }
  }

  inFlight = sendRequest()

  return {
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await inFlight
      return {
        enabled: true,
        intervalMs,
        attempts,
        completedResponses,
        deliveryFailures,
        statusClassCounts,
        responseTimeSamplesMs: responseTimesMs,
        responseSamples,
        averageResponseTimeMs: responseTimesMs.length
          ? responseTimesMs.reduce((total, duration) => total + duration, 0) /
            responseTimesMs.length
          : null,
      }
    },
  }
}
