const monitoredServices = new Set([
  'user-service',
  'order-service',
  'payment-service',
  'notification-service',
])
const scrapeFreshnessWindowMs = 2000

function metricSelector(metric, service) {
  if (!monitoredServices.has(service)) {
    throw new Error(`Unsupported Prometheus service label: ${service}`)
  }
  return `${metric}{service="${service}"}`
}

export function buildHttpErrorRateQueries(service, windowMs) {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new RangeError('Prometheus observation window must be positive milliseconds')
  }

  const duration = `${windowMs}ms`
  const requests = metricSelector('chaosguard_http_requests_total', service)
  const errors = metricSelector('chaosguard_http_server_errors_total', service)
  const clientErrors = metricSelector('chaosguard_http_client_errors_total', service)

  return {
    sampleCount: `sum(count_over_time(${requests}[${duration}]))`,
    scrapeCoverage: `count_over_time(${requests}[${scrapeFreshnessWindowMs}ms])`,
    totalRequests: `sum(increase(${requests}[${duration}]))`,
    failedRequests: `sum(increase(${errors}[${duration}]))`,
    clientErrorRequests: `sum(increase(${clientErrors}[${duration}]))`,
  }
}

function validCount(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function roundCount(value) {
  return value === null ? null : Math.round(value * 100) / 100
}

export function createErrorRateMeasurement({
  target,
  windowStart,
  windowEnd,
  sampleCount,
  totalRequests,
  failedRequests,
  clientErrorRequests,
  monitoringCoveragePercent,
}) {
  const startMs = Date.parse(windowStart)
  const endMs = Date.parse(windowEnd)
  const windowDurationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? endMs - startMs
      : null
  const validSampleCount = validCount(sampleCount)
  const requestCount = validCount(totalRequests)
  const serverErrorCount = validCount(failedRequests)
  const clientErrorCount = validCount(clientErrorRequests)

  const base = {
    source: 'prometheus-http-counters',
    target,
    windowStart,
    windowEnd,
    windowDurationMs,
    requestCountMethod:
      'PromQL increase() estimate; fractional counts are expected from range extrapolation.',
    scrapeSampleCount:
      validSampleCount === null ? null : Math.floor(validSampleCount),
    totalRequests: roundCount(requestCount),
    failedRequests: roundCount(serverErrorCount),
    clientErrorRequests: roundCount(clientErrorCount),
    successfulRequests: null,
    monitoringCoveragePercent:
      Number.isFinite(monitoringCoveragePercent) &&
      monitoringCoveragePercent >= 0 &&
      monitoringCoveragePercent <= 100
        ? Math.round(monitoringCoveragePercent * 100) / 100
        : null,
    errorRatePercent: null,
  }

  if (windowDurationMs === null) {
    return {
      ...base,
      status: 'unavailable',
      reason: 'The experiment has no valid positive monitoring window.',
    }
  }

  if (validSampleCount === null || validSampleCount < 2) {
    return {
      ...base,
      status: 'insufficient-samples',
      reason:
        validSampleCount === null || validSampleCount === 0
          ? 'Prometheus has no HTTP counter samples in the experiment window. Confirm the ServiceMonitor target is UP and has completed at least two scrapes.'
          : 'At least two Prometheus counter samples are required to account for counter resets.',
    }
  }

  if (
    !Number.isFinite(monitoringCoveragePercent) ||
    monitoringCoveragePercent < 80
  ) {
    return {
      ...base,
      totalRequests: null,
      failedRequests: null,
      clientErrorRequests: null,
      status: 'insufficient-coverage',
      reason:
        `Prometheus observed the HTTP counter for ${base.monitoringCoveragePercent ?? 0}% of the experiment window; at least 80% coverage is required. Missing/stale samples are not treated as successful requests.`,
    }
  }

  if (
    requestCount === null ||
    serverErrorCount === null ||
    clientErrorCount === null
  ) {
    return {
      ...base,
      status: 'insufficient-samples',
      reason:
        'Prometheus did not return valid counter increases for the complete experiment window.',
    }
  }

  if (
    serverErrorCount > requestCount + 0.001 ||
    clientErrorCount > requestCount + 0.001
  ) {
    return {
      ...base,
      status: 'inconsistent-data',
      reason:
        'Prometheus reported more HTTP error responses than received requests; the error rate is not trustworthy.',
    }
  }

  if (requestCount === 0) {
    return {
      ...base,
      status: 'no-traffic',
      reason: 'No HTTP requests were observed during the experiment window.',
    }
  }

  return {
    ...base,
    successfulRequests: roundCount(
      Math.max(0, requestCount - serverErrorCount - clientErrorCount),
    ),
    status: 'measured',
    errorRatePercent:
      Math.round((serverErrorCount / requestCount) * 100 * 10000) / 10000,
    reason: null,
  }
}
