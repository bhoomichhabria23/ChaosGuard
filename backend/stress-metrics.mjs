export const STRESS_RECOVERY_TOLERANCE_PERCENT = 10
export const STRESS_RECOVERY_TIMEOUT_MS = 30000

const memoryUnits = {
  B: 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
}

export function parseCpuQuantity(quantity) {
  if (typeof quantity === 'number') {
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null
  }
  if (typeof quantity !== 'string') return null
  const match = quantity.trim().match(/^(\d+(?:\.\d+)?)(n|u|m)?$/)
  if (!match) return null
  const value = Number(match[1])
  const divisor = { n: 1e9, u: 1e6, m: 1e3 }[match[2]] || 1
  return Number.isFinite(value) ? value / divisor : null
}

export function parseMemoryQuantity(quantity) {
  if (typeof quantity === 'number') {
    return Number.isFinite(quantity) && quantity >= 0 ? quantity : null
  }
  if (typeof quantity !== 'string') return null
  const match = quantity.trim().match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|B|k|K|M|G|T|P|E)?$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value)
    ? value * (memoryUnits[match[2] || 'B'])
    : null
}

export function utilizationPercent(usage, capacity) {
  if (
    !Number.isFinite(usage) ||
    usage < 0 ||
    !Number.isFinite(capacity) ||
    capacity <= 0
  ) {
    return null
  }
  return (usage / capacity) * 100
}

export function measureStressDetection(
  experiment,
  { responseTimeDegradationTolerancePercent = 20 } = {},
) {
  const startedAt = Date.parse(experiment.startedAt)
  const endedAt = Date.parse(experiment.completedAt)
  const stressEndedAt = Date.parse(experiment.stressEndedAt)
  if (
    experiment.readyBefore !== true ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt <= startedAt
  ) {
    return {
      status: 'unavailable',
      detectionTimeMs: null,
      source: 'kubernetes-api-pod-readiness',
      reason: 'A healthy baseline and valid experiment window are required to measure detection.',
    }
  }

  const detectionWindowEnd = Number.isFinite(stressEndedAt)
    ? Math.min(endedAt, stressEndedAt)
    : endedAt
  const readinessSamples = (experiment.readinessSamples || [])
    .map((sample) => ({
      ...sample,
      timestamp: Date.parse(sample?.recordedAt),
    }))
    .filter((sample) =>
      Number.isFinite(sample.timestamp) &&
      sample.timestamp <= detectionWindowEnd,
    )
    .sort((left, right) => left.timestamp - right.timestamp)
  const unhealthyObservations = readinessSamples
    .filter((sample) =>
      sample.timestamp > startedAt &&
      Number.isSafeInteger(sample.readyPods) &&
      sample.readyPods === 0 &&
      Number.isSafeInteger(sample.totalPods) &&
      sample.totalPods > 0,
    )
    .map((sample) => ({
      timestamp: sample.timestamp,
      unhealthyCondition: 'zero-ready-pods',
    }))

  const baselineResponseTimeMs =
    experiment.baselineResponseTimeMeasurement?.status === 'measured'
      ? experiment.baselineResponseTimeMeasurement.responseTimeMs
      : null
  if (
    Number.isFinite(baselineResponseTimeMs) &&
    baselineResponseTimeMs > 0 &&
    Number.isFinite(responseTimeDegradationTolerancePercent) &&
    responseTimeDegradationTolerancePercent >= 0
  ) {
    const degradedResponseTimeMs =
      baselineResponseTimeMs *
      (1 + responseTimeDegradationTolerancePercent / 100)
    for (const sample of experiment.httpTrafficProbeMeasurement?.responseSamples || []) {
      const timestamp = Date.parse(sample?.recordedAt)
      if (
        !Number.isFinite(timestamp) ||
        timestamp <= startedAt ||
        timestamp > detectionWindowEnd
      ) {
        continue
      }
      const unhealthyCondition = sample.requestFailed
        ? 'http-probe-request-failed'
        : Number.isInteger(sample.statusCode) && sample.statusCode >= 500
          ? 'http-server-error'
          : Number.isFinite(sample.responseTimeMs) &&
              sample.responseTimeMs > degradedResponseTimeMs
            ? 'response-time-degradation'
            : null
      if (unhealthyCondition) {
        unhealthyObservations.push({ timestamp, unhealthyCondition })
      }
    }
  }

  if (experiment.type === 'memory-stress') {
    const restartCounts = new Map()
    for (const sample of readinessSamples) {
      for (const container of sample.oomKilledContainers || []) {
        const terminationTime = Date.parse(container?.finishedAt)
        if (
          sample.timestamp > startedAt &&
          Number.isFinite(terminationTime) &&
          terminationTime >= startedAt &&
          terminationTime <= detectionWindowEnd
        ) {
          unhealthyObservations.push({
            timestamp: sample.timestamp,
            unhealthyCondition: 'oom-killed-container',
          })
        }
      }

      for (const pod of sample.podRestartCounts || []) {
        if (
          typeof pod?.podId !== 'string' ||
          !Number.isSafeInteger(pod.restartCount) ||
          pod.restartCount < 0
        ) {
          continue
        }
        const previousCount = restartCounts.get(pod.podId)
        if (
          sample.timestamp > startedAt &&
          previousCount !== undefined &&
          pod.restartCount > previousCount
        ) {
          unhealthyObservations.push({
            timestamp: sample.timestamp,
            unhealthyCondition: 'pod-restart',
          })
        }
        restartCounts.set(
          pod.podId,
          Math.max(previousCount ?? 0, pod.restartCount),
        )
      }
    }
  }

  const firstUnhealthySample = unhealthyObservations
    .sort((left, right) => left.timestamp - right.timestamp)[0]

  if (!firstUnhealthySample) {
    return {
      status: 'not-detected',
      detectionTimeMs: null,
      source: 'kubernetes-api-pod-readiness',
      reason: experiment.type === 'memory-stress'
        ? 'No zero-ready, OOMKilled, pod-restart, HTTP failure, or response-time degradation condition was observed during memory stress; no detection time is claimed.'
        : 'No zero-ready, HTTP failure, or response-time degradation condition was observed during CPU stress; no detection time is claimed.',
    }
  }

  const detectionTimeMs = firstUnhealthySample.timestamp - startedAt
  return detectionTimeMs > 0
    ? {
        status: 'measured',
        detectionTimeMs,
        source: 'kubernetes-api-pod-readiness',
        unhealthyCondition: firstUnhealthySample.unhealthyCondition,
        detectedAt: new Date(firstUnhealthySample.timestamp).toISOString(),
        reason: null,
      }
    : {
        status: 'unavailable',
        detectionTimeMs: null,
        source: 'kubernetes-api-pod-readiness',
        reason: 'The observed unhealthy timestamp did not produce a positive measurable detection duration.',
      }
}

export async function measureReadinessRecovery({
  afterTimestamp,
  sample,
  timeoutMs = 30000,
  intervalMs = 500,
  consecutiveSamples = 2,
  now = Date.now,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
}) {
  const afterTimestampMs = Date.parse(afterTimestamp)
  if (
    !Number.isFinite(afterTimestampMs) ||
    typeof sample !== 'function' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs < 1 ||
    !Number.isSafeInteger(consecutiveSamples) ||
    consecutiveSamples < 1
  ) {
    throw new TypeError('Invalid readiness recovery measurement options')
  }

  const deadline = now() + timeoutMs
  let consecutive = 0
  while (now() <= deadline) {
    const observation = await sample()
    const timestamp = Date.parse(observation?.recordedAt)
    const readyPods = observation?.readyPods
    const totalPods = observation?.totalPods
    const valid =
      Number.isFinite(timestamp) &&
      timestamp >= afterTimestampMs &&
      Number.isSafeInteger(readyPods) &&
      readyPods >= 0 &&
      Number.isSafeInteger(totalPods) &&
      totalPods > 0 &&
      readyPods <= totalPods

    if (valid && readyPods > 0) {
      consecutive += 1
      const recoveryTimeMs = timestamp - afterTimestampMs
      if (consecutive >= consecutiveSamples && recoveryTimeMs > 0) {
        return {
          status: 'measured',
          recoveryTimeMs,
          source: 'kubernetes-api-pod-readiness',
          healthySamplesRequired: consecutiveSamples,
          recoveredAt: observation.recordedAt,
          reason: null,
        }
      }
    } else if (valid) {
      consecutive = 0
    }

    const remaining = deadline - now()
    if (remaining <= 0) break
    await wait(Math.min(intervalMs, remaining))
  }

  return {
    status: 'recovery-timeout',
    recoveryTimeMs: null,
    source: 'kubernetes-api-pod-readiness',
    timeoutMs,
    reason:
      `The service did not produce ${consecutiveSamples} consecutive healthy readiness observations within ${timeoutMs} ms after the event ended.`,
  }
}

export async function measureResourceRecovery({
  resource,
  baseline,
  sample,
  timeoutMs = STRESS_RECOVERY_TIMEOUT_MS,
  intervalMs = 1000,
  tolerancePercent = STRESS_RECOVERY_TOLERANCE_PERCENT,
  consecutiveSamples = 2,
  now = Date.now,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
}) {
  if (!['cpu', 'memory'].includes(resource)) {
    throw new TypeError('Recovery resource must be cpu or memory')
  }
  if (
    !Number.isFinite(baseline) ||
    baseline < 0 ||
    typeof sample !== 'function' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs < 1 ||
    !Number.isFinite(tolerancePercent) ||
    tolerancePercent < 0 ||
    !Number.isSafeInteger(consecutiveSamples) ||
    consecutiveSamples < 1
  ) {
    throw new TypeError('Invalid resource recovery measurement options')
  }

  const startedAt = now()
  const deadline = startedAt + timeoutMs
  const recoveryLimit = baseline * (1 + tolerancePercent / 100)
  let consecutive = 0

  while (now() <= deadline) {
    const observation = await sample()
    const current = resource === 'cpu'
      ? observation?.cpuCores
      : observation?.memoryBytes
    if (Number.isFinite(current) && current >= 0 && current <= recoveryLimit) {
      consecutive += 1
      if (consecutive >= consecutiveSamples) {
        return {
          status: 'measured',
          recoveryTimeMs: now() - startedAt,
          reason: null,
          source: 'prometheus-resource-usage',
          resource,
          baseline,
          recoveryLimit,
          tolerancePercent,
          consecutiveSamples,
        }
      }
    } else {
      consecutive = 0
    }

    const remaining = deadline - now()
    if (remaining <= 0) break
    await wait(Math.min(intervalMs, remaining))
  }

  return {
    status: 'unavailable',
    recoveryTimeMs: null,
    reason: `Prometheus did not observe ${resource} usage at or below ${recoveryLimit} within ${timeoutMs} ms after stress ended.`,
    source: 'prometheus-resource-usage',
    resource,
    baseline,
    recoveryLimit,
    tolerancePercent,
    consecutiveSamplesRequired: consecutiveSamples,
  }
}
