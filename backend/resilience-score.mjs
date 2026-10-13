import { inferReadinessTimings } from './pod-failure-observations.mjs'

export const RESILIENCE_SCORE_WEIGHTS = Object.freeze({
  availability: 20,
  performance: 20,
  errorHandling: 20,
  detection: 20,
  recovery: 20,
})

const defaultScoreTargets = Object.freeze({
  responseTimeDegradationTolerancePercent: 20,
  detectionTimeMs: 1000,
  recoveryTimeMs: 5000,
})

export function getResilienceScoreTargets() {
  const targets = {
    responseTimeDegradationTolerancePercent: Number(
      process.env.CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT ??
        defaultScoreTargets.responseTimeDegradationTolerancePercent,
    ),
    detectionTimeMs: Number(
      process.env.CHAOSGUARD_DETECTION_TARGET_MS ??
        defaultScoreTargets.detectionTimeMs,
    ),
    recoveryTimeMs: Number(
      process.env.CHAOSGUARD_RECOVERY_TARGET_MS ??
        defaultScoreTargets.recoveryTimeMs,
    ),
  }
  for (const [name, value] of Object.entries(targets)) {
    const invalidValue =
      !Number.isFinite(value) ||
      (name === 'responseTimeDegradationTolerancePercent'
        ? value < 0
        : value <= 0)
    if (invalidValue) {
      throw new Error(
        name === 'responseTimeDegradationTolerancePercent'
          ? `${name} must be configured as a non-negative percentage`
          : `${name} must be configured as a positive number of milliseconds`,
      )
    }
  }
  return targets
}

export function measureAvailability({
  readinessSamples,
  windowStart,
  windowEnd,
  maximumSampleGapMs = 2000,
  minimumCoveragePercent = 80,
}) {
  const startMs = Date.parse(windowStart)
  const endMs = Date.parse(windowEnd)
  const validOptions =
    Number.isFinite(maximumSampleGapMs) &&
    maximumSampleGapMs > 0 &&
    Number.isFinite(minimumCoveragePercent) &&
    minimumCoveragePercent > 0 &&
    minimumCoveragePercent <= 100
  const windowDurationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? endMs - startMs
      : null
  const samples = Array.isArray(readinessSamples)
    ? readinessSamples
      .map((sample) => {
        const timestamp = Date.parse(sample?.recordedAt)
        const readyPods = sample?.readyPods
        const totalPods = sample?.totalPods
        if (
          !validOptions ||
          !Number.isFinite(startMs) ||
          !Number.isFinite(endMs) ||
          !Number.isFinite(timestamp) ||
          !Number.isSafeInteger(readyPods) ||
          readyPods < 0 ||
          !Number.isSafeInteger(totalPods) ||
          totalPods <= 0 ||
          readyPods > totalPods ||
          timestamp < startMs ||
          timestamp > endMs
        ) {
          return null
        }
        return { timestamp, healthy: readyPods > 0 }
      })
      .filter(Boolean)
      .sort((left, right) => left.timestamp - right.timestamp)
    : []
  const samplesByTimestamp = new Map()
  for (const sample of samples) {
    const current = samplesByTimestamp.get(sample.timestamp)
    if (!current) {
      samplesByTimestamp.set(sample.timestamp, {
        ...sample,
        conflictingDuplicate: false,
      })
    } else if (current.healthy !== sample.healthy) {
      current.conflictingDuplicate = true
    }
  }
  const uniqueSamples = [...samplesByTimestamp.values()]
    .filter((sample) => !sample.conflictingDuplicate)
    .map(({ conflictingDuplicate, ...sample }) => sample)

  const base = {
    source: 'kubernetes-api-pod-readiness',
    windowStart,
    windowEnd,
    windowDurationMs,
    validSampleCount: uniqueSamples.length,
    healthySampleCount: uniqueSamples.filter((sample) => sample.healthy).length,
    healthyDurationMs: 0,
    validObservedDurationMs: 0,
    monitoringCoveragePercent: null,
    availabilityPercent: null,
  }

  if (windowDurationMs === null) {
    return {
      ...base,
      status: 'unavailable',
      reason:
        'The experiment has no valid positive readiness observation window; timestamps must be valid and the end must follow the start.',
    }
  }

  if (!validOptions) {
    return {
      ...base,
      status: 'unavailable',
      reason:
        'Readiness coverage settings must use a positive sample gap and a coverage threshold between 0 and 100%.',
    }
  }

  let validObservedDurationMs = 0
  let healthyDurationMs = 0
  for (let index = 0; index < uniqueSamples.length; index += 1) {
    const sample = uniqueSamples[index]
    const nextSampleTime =
      uniqueSamples[index + 1]?.timestamp ?? endMs
    const intervalEnd = Math.min(
      nextSampleTime,
      sample.timestamp + maximumSampleGapMs,
      endMs,
    )
    const intervalDuration = Math.max(0, intervalEnd - sample.timestamp)
    validObservedDurationMs += intervalDuration
    if (sample.healthy) healthyDurationMs += intervalDuration
  }

  const monitoringCoveragePercent =
    Math.min(100, (validObservedDurationMs / windowDurationMs) * 100)
  const coverage = {
    ...base,
    healthyDurationMs,
    validObservedDurationMs,
    monitoringCoveragePercent:
      Math.round(monitoringCoveragePercent * 100) / 100,
  }

  if (uniqueSamples.length < 2 || validObservedDurationMs <= 0) {
    return {
      ...coverage,
      status: 'insufficient-samples',
      reason:
        'At least two timestamped Kubernetes readiness observations in the experiment window are required.',
    }
  }

  if (monitoringCoveragePercent < minimumCoveragePercent) {
    return {
      ...coverage,
      status: 'insufficient-coverage',
      reason:
        `Readiness observations covered ${coverage.monitoringCoveragePercent}% of the window; at least ${minimumCoveragePercent}% coverage is required. Gaps longer than ${maximumSampleGapMs} ms are not treated as healthy or unhealthy.`,
    }
  }

  return {
    ...coverage,
    status: 'measured',
    availabilityPercent:
      Math.round(
        (base.healthySampleCount / base.validSampleCount) * 10000,
      ) / 100,
    reason: null,
  }
}

function scoreRatio(target, actual) {
  if (
    !Number.isFinite(target) ||
    target <= 0 ||
    !Number.isFinite(actual) ||
    actual <= 0
  ) {
    return null
  }
  return Math.round(Math.min(100, (target / actual) * 100) * 100) / 100
}

function validPercent(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value * 100) / 100
    : null
}

function measureErrorHandling(measurement) {
  if (measurement?.status !== 'measured') return null
  const totalRequests = measurement.totalRequests
  const successfulRequests = measurement.successfulRequests ??
    (Number.isFinite(totalRequests) &&
      Number.isFinite(measurement.failedRequests) &&
      Number.isFinite(measurement.clientErrorRequests)
      ? totalRequests - measurement.failedRequests - measurement.clientErrorRequests
      : null)
  if (
    !Number.isFinite(totalRequests) ||
    totalRequests <= 0 ||
    !Number.isFinite(successfulRequests) ||
    successfulRequests < 0 ||
    successfulRequests > totalRequests
  ) {
    return null
  }
  return Math.round((successfulRequests / totalRequests) * 10000) / 100
}

function calculateStressResilienceScore(experiment) {
  return calculateCommonResilienceScore(experiment)
}

function calculateCommonResilienceScore(experiment) {
  const targets = getResilienceScoreTargets()
  const availabilityMeasurement = experiment.availabilityMeasurement
  const responseTimeMeasurement = experiment.responseTimeMeasurement ||
    experiment.httpTrafficProbeMeasurement
  const baselineResponseMeasurement =
    experiment.baselineResponseTimeMeasurement || null
  const baselineResponseTimeMs = responseTimeMeasurement?.baselineResponseTimeMs ??
    experiment.baselineResponseTimeMs
  const averageResponseTimeMs = responseTimeMeasurement?.averageResponseTimeMs ??
    experiment.averageResponseTimeMs
  const detectionMeasurement = experiment.detectionMeasurement
  const recoveryMeasurement = experiment.recoveryMeasurement
  const inferredTimings = inferReadinessTimings(experiment)
  const detectionTimeMs = detectionMeasurement
    ? detectionMeasurement.status === 'measured'
      ? detectionMeasurement.detectionTimeMs
      : null
    : experiment.status === 'detection-timeout'
      ? null
      : experiment.detectionTimeMs ?? inferredTimings.detectionTimeMs
  const recoveryTimeMs = recoveryMeasurement
    ? recoveryMeasurement.status === 'measured'
      ? recoveryMeasurement.recoveryTimeMs
      : null
    : experiment.status === 'recovery-timeout'
      ? null
      : experiment.recoveryTimeMs ?? inferredTimings.recoveryTimeMs
  const errorHandlingScore = measureErrorHandling(experiment.errorRateMeasurement)
  const performanceThresholdMs =
    Number.isFinite(baselineResponseTimeMs) && baselineResponseTimeMs > 0
      ? baselineResponseTimeMs *
        (1 + targets.responseTimeDegradationTolerancePercent / 100)
      : null
  const scoreBreakdown = {
    availability: availabilityMeasurement?.status === 'measured'
      ? validPercent(availabilityMeasurement.availabilityPercent)
      : null,
    performance: responseTimeMeasurement?.status === 'measured'
      ? scorePerformance({
          baselineResponseTimeMs,
          averageResponseTimeMs,
        })
      : null,
    errorHandling: errorHandlingScore,
    detection: scoreRatio(targets.detectionTimeMs, detectionTimeMs),
    recovery: scoreRatio(targets.recoveryTimeMs, recoveryTimeMs),
  }
  const missingMetricReasons = {}
  const reasons = {
    availability: availabilityMeasurement?.reason ||
      'No sufficiently covered Kubernetes readiness measurement was recorded.',
    performance: responseTimeMeasurement?.reason ||
      'Actual response-time samples were not recorded during the experiment.',
    errorHandling: experiment.errorRateMeasurement?.reason ||
      'Prometheus did not provide valid request and error counts for the experiment.',
    detection: detectionMeasurement?.reason ||
      'No valid monitoring detection time was recorded.',
    recovery: recoveryMeasurement?.reason ||
      'No valid post-injection service recovery time was recorded.',
  }
  for (const [metric, score] of Object.entries(scoreBreakdown)) {
    if (score === null) missingMetricReasons[metric] = reasons[metric]
  }

  const complete =
    Object.values(scoreBreakdown).every(Number.isFinite) &&
    experiment.status === 'completed'
  const averageScore = complete
    ? Object.values(scoreBreakdown).reduce((total, score) => total + score, 0) / 5
    : null
  const resilienceScore = averageScore === null
    ? null
    : Math.round(averageScore * 100) / 100

  return {
    resilienceScore,
    scoreBreakdown,
    scoreWeights: RESILIENCE_SCORE_WEIGHTS,
    scoreTargets: targets,
    effectiveScoreWeights: complete ? RESILIENCE_SCORE_WEIGHTS : {},
    scoreStatus: complete
      ? 'complete-real-metrics'
      : experiment.status !== 'completed'
        ? 'incomplete-experiment'
        : 'insufficient-metrics',
    scoreUnavailableReason: complete
      ? null
      : experiment.status !== 'completed'
        ? `A final score requires a completed experiment; current status is "${experiment.status || 'unknown'}".`
        : 'A final score requires valid measurements for all five components.',
    missingMetrics: Object.keys(missingMetricReasons),
    missingMetricReasons,
    scoreMeasurements: {
      availabilityPercent: validPercent(availabilityMeasurement?.availabilityPercent),
      availabilityMeasurement: availabilityMeasurement || null,
      readinessObservationCount:
        availabilityMeasurement?.validSampleCount ?? 0,
      baselineResponseTimeMs:
        Number.isFinite(baselineResponseTimeMs) && baselineResponseTimeMs > 0
          ? baselineResponseTimeMs
          : null,
      averageResponseTimeMs:
        Number.isFinite(averageResponseTimeMs) && averageResponseTimeMs > 0
          ? averageResponseTimeMs
          : null,
      acceptableResponseTimeMs: performanceThresholdMs,
      responseTimeDegradationPercent:
        Number.isFinite(baselineResponseTimeMs) &&
        baselineResponseTimeMs > 0 &&
        Number.isFinite(averageResponseTimeMs) &&
        averageResponseTimeMs > 0
          ? Math.round(
              ((averageResponseTimeMs - baselineResponseTimeMs) /
                baselineResponseTimeMs) *
                10000,
            ) / 100
          : null,
      errorHandlingMeasurement: experiment.errorRateMeasurement || null,
      baselineErrorHandlingMeasurement:
        baselineResponseMeasurement || null,
      successfulRequests:
        experiment.errorRateMeasurement?.successfulRequests ?? null,
      totalRequests:
        experiment.errorRateMeasurement?.totalRequests ?? null,
      baselineSuccessfulRequests:
        baselineResponseMeasurement?.successfulRequests ?? null,
      baselineTotalRequests:
        baselineResponseMeasurement?.totalRequests ?? null,
      baselineErrorRatePercent:
        Number.isFinite(baselineResponseMeasurement?.errorRatePercent)
          ? baselineResponseMeasurement.errorRatePercent
          : null,
      detectionTimeMs:
        Number.isFinite(detectionTimeMs) && detectionTimeMs > 0
          ? detectionTimeMs
          : null,
      detectionMeasurement: detectionMeasurement || null,
      recoveryTimeMs:
        Number.isFinite(recoveryTimeMs) && recoveryTimeMs > 0
          ? recoveryTimeMs
          : null,
      recoveryMeasurement: recoveryMeasurement || null,
      cpuUtilizationPercent:
        Number.isFinite(experiment.cpuUtilizationPercent) &&
        experiment.cpuUtilizationPercent >= 0
          ? experiment.cpuUtilizationPercent
          : null,
      memoryUtilizationPercent:
        Number.isFinite(experiment.memoryUtilizationPercent) &&
        experiment.memoryUtilizationPercent >= 0
          ? experiment.memoryUtilizationPercent
          : null,
      restartCountDelta: getRestartCountDelta(experiment),
      podRestartCount:
        Number.isSafeInteger(experiment.podRestartCount) &&
        experiment.podRestartCount >= 0
          ? experiment.podRestartCount
          : null,
      oomKilledObservations:
        Array.isArray(experiment.oomKilledObservations)
          ? experiment.oomKilledObservations
          : [],
      metricMeasurementStatus: Object.fromEntries(
        Object.entries(scoreBreakdown).map(([metric, score]) => [
          metric,
          score === null ? 'unavailable' : 'measured',
        ]),
      ),
    },
  }
}

export function scoreRecovery(experiment) {
  if (experiment.status === 'recovery-timeout') return null
  const inferredTimings =
    inferReadinessTimings(experiment)
  const inferredRecovery =
    experiment.recoveryTimeMs === null ||
    experiment.recoveryTimeMs === undefined
      ? inferredTimings.recoveryTimeMs
      : null

  return scoreRatio(
    getResilienceScoreTargets().recoveryTimeMs,
    experiment.recoveryTimeMs ?? inferredRecovery,
  )
}

export function scoreDetection(experiment) {
  if (experiment.status === 'detection-timeout') return null
  const inferredTimings =
    inferReadinessTimings(experiment)
  const inferredDetection =
    experiment.detectionTimeMs === null ||
    experiment.detectionTimeMs === undefined
      ? inferredTimings.detectionTimeMs
      : null

  return scoreRatio(
    getResilienceScoreTargets().detectionTimeMs,
    experiment.detectionTimeMs ?? inferredDetection,
  )
}

export function scorePerformance({ baselineResponseTimeMs, averageResponseTimeMs }) {
  const targets = getResilienceScoreTargets()
  const acceptableResponseTimeMs =
    Number.isFinite(baselineResponseTimeMs) && baselineResponseTimeMs > 0
      ? baselineResponseTimeMs *
        (1 + targets.responseTimeDegradationTolerancePercent / 100)
      : null
  return scoreRatio(acceptableResponseTimeMs, averageResponseTimeMs)
}

export function scoreAvailability(availabilityPercent) {
  if (
    !Number.isFinite(availabilityPercent) ||
    availabilityPercent < 0 ||
    availabilityPercent > 100
  ) {
    return null
  }

  return Math.round(availabilityPercent * 100) / 100
}

export function scoreStability(experiment) {
  if (experiment.type === 'pod-failure') {
    const measurement = measurePodStability(experiment)
    return measurement.status === 'measured'
      ? scoreRestartCount(measurement.disruptionCount)
      : null
  }

  const restartCount = getRestartCountDelta(experiment)

  if (!Number.isSafeInteger(restartCount) || restartCount < 0) return null
  return scoreRestartCount(restartCount)
}

function scorePodFailureAvailability(measurement) {
  const availabilityPercent = scoreAvailability(
    measurement?.availabilityPercent,
  )
  const coveragePercent = scoreAvailability(
    measurement?.monitoringCoveragePercent,
  )

  if (availabilityPercent === null || coveragePercent === null) return null

  return Math.round(availabilityPercent * coveragePercent) / 100
}

function scoreRestartCount(restartCount) {
  if (!Number.isSafeInteger(restartCount) || restartCount < 0) return null
  if (restartCount === 0) return 100
  if (restartCount === 1) return 70
  if (restartCount <= 3) return 40
  return 0
}

export function measurePodStability(experiment) {
  const failureObservation = experiment.failureObservation
  const confirmedFailure =
    failureObservation?.observed === true ||
    (
      ['completed', 'recovery-timeout'].includes(experiment.status) &&
      Boolean(experiment.replacementPodName)
    )
  const evidence = {
    source: 'kubernetes-api-pod-observations',
    failedPodName: experiment.podName || null,
    failedPodUid: experiment.failedPodUid || null,
    failureObserved: confirmedFailure,
    failureReason:
      failureObservation?.reason ||
      (confirmedFailure ? 'legacy-confirmed-failure' : null),
    replacementPodName: experiment.replacementPodName || null,
    replacementPodUid: experiment.replacementPodUid || null,
    replacementCandidatePodName:
      experiment.replacementCandidatePodName || null,
    replacementCandidatePodUid:
      experiment.replacementCandidatePodUid || null,
    replacementCandidatePodReady:
      experiment.replacementCandidatePodReady ?? null,
  }
  const excludedPodIds = [
    experiment.failedPodUid,
    experiment.podName,
  ].filter((podId) => typeof podId === 'string' && podId)

  if (!confirmedFailure) {
    return {
      ...evidence,
      status: 'unavailable',
      reason:
        'Kubernetes did not confirm the selected pod failure; stability cannot be scored.',
      restartCountDelta: null,
      comparablePodCount: 0,
    }
  }

  const restartMeasurement = getObservedRestartCountMeasurement(
    experiment.readinessSamples,
    excludedPodIds,
  )
  const restartCountDelta =
    restartMeasurement.status === 'measured'
      ? restartMeasurement.restartCountDelta
      : null
  const failureEventCount = confirmedFailure ? 1 : 0

  return {
    ...(restartMeasurement.status === 'measured'
      ? restartMeasurement
      : {
          restartCountDelta: null,
          comparablePodCount: 0,
        }),
    ...evidence,
    failureEventCount,
    podReplacementObserved: Boolean(
      (
        experiment.replacementPodUid &&
        experiment.replacementPodUid !== experiment.failedPodUid
      ) ||
      (
        experiment.replacementPodName &&
        experiment.replacementPodName !== experiment.podName
      ),
    ),
    disruptionCount: failureEventCount + (restartCountDelta ?? 0),
    restartMeasurementStatus: restartMeasurement.status,
    status: 'measured',
    reason: null,
  }
}

export function scoreErrorRate(errorRatePercent) {
  if (
    !Number.isFinite(errorRatePercent) ||
    errorRatePercent < 0 ||
    errorRatePercent > 100
  ) {
    return null
  }

  return Math.round((100 - errorRatePercent) * 100) / 100
}

export function calculateResilienceScore(experiment) {
  return calculateCommonResilienceScore(experiment)
}

function getScoreMeasurementDuration(measured, inferred) {
  const value = measured ?? inferred
  return Number.isFinite(value) && value >= 0 ? value : null
}

function meanAvailabilityPercent(measurement) {
  return measurement?.status === 'measured' &&
    Number.isFinite(measurement.availabilityPercent)
    ? measurement.availabilityPercent
    : null
}

function getRestartCountDelta(experiment) {
  const observedDelta =
    getObservedRestartCountDelta(experiment.readinessSamples)

  if (observedDelta !== undefined) return observedDelta
  if (experiment.type === 'pod-failure') return null

  if (
    Number.isSafeInteger(experiment.restartCountBefore) &&
    Number.isSafeInteger(experiment.restartCountAfter) &&
    experiment.restartCountAfter >= experiment.restartCountBefore
  ) {
    return experiment.restartCountAfter - experiment.restartCountBefore
  }
  return Number.isSafeInteger(experiment.podRestartCount) &&
    experiment.podRestartCount >= 0
    ? experiment.podRestartCount
    : null
}

function getObservedRestartCountDelta(readinessSamples) {
  const measurement = getObservedRestartCountMeasurement(readinessSamples)
  if (measurement.status === 'not-observed') return undefined
  return measurement.status === 'measured'
    ? measurement.restartCountDelta
    : null
}

function getObservedRestartCountMeasurement(
  readinessSamples,
  excludedPodIds = [],
) {
  if (!Array.isArray(readinessSamples)) {
    return {
      status: 'not-observed',
      restartCountDelta: null,
      comparablePodCount: 0,
    }
  }

  const countsByPod = new Map()
  let hasObservationField = false
  let hasObservedCounts = false

  for (const sample of readinessSamples) {
    if (!Array.isArray(sample?.podRestartCounts)) continue
    hasObservationField = true

    for (const observation of sample.podRestartCounts) {
      const { podId, restartCount } = observation || {}
      if (
        typeof podId !== 'string' ||
        !podId ||
        excludedPodIds.includes(podId) ||
        !Number.isSafeInteger(restartCount) ||
        restartCount < 0
      ) {
        continue
      }

      hasObservedCounts = true
      const podCounts = countsByPod.get(podId) || {
        first: restartCount,
        last: restartCount,
        observations: 0,
      }
      podCounts.last = restartCount
      podCounts.observations += 1
      countsByPod.set(podId, podCounts)
    }
  }

  if (!hasObservationField) {
    return {
      status: 'not-observed',
      restartCountDelta: null,
      comparablePodCount: 0,
    }
  }
  if (!hasObservedCounts) {
    return {
      status: 'unavailable',
      restartCountDelta: null,
      comparablePodCount: 0,
    }
  }

  const comparablePods = [...countsByPod.values()].filter(
    ({ observations }) => observations >= 2,
  )
  if (
    comparablePods.length === 0 ||
    comparablePods.some(({ first, last }) => last < first)
  ) {
    return {
      status: 'unavailable',
      restartCountDelta: null,
      comparablePodCount: 0,
    }
  }

  return {
    status: 'measured',
    restartCountDelta: comparablePods.reduce(
      (total, { first, last }) => total + last - first,
      0,
    ),
    comparablePodCount: comparablePods.length,
  }
}
