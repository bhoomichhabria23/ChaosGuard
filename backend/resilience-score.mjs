import { inferReadinessTimings } from './pod-failure-observations.mjs'

export const RESILIENCE_SCORE_WEIGHTS = Object.freeze({
  recovery: 35,
  detection: 25,
  availability: 25,
  stability: 15,
})

const defaultTimeScoreThresholds = Object.freeze([
  Object.freeze({ maxMs: 1000, score: 100 }),
  Object.freeze({ maxMs: 3000, score: 90 }),
  Object.freeze({ maxMs: 5000, score: 80 }),
  Object.freeze({ maxMs: 10000, score: 60 }),
  Object.freeze({ maxMs: 20000, score: 40 }),
  Object.freeze({ maxMs: null, score: 20 }),
])

function loadTimeScoreThresholds(environmentName) {
  const configured = process.env[environmentName]
  const thresholds = configured === undefined
    ? defaultTimeScoreThresholds
    : JSON.parse(configured)
  const valid =
    Array.isArray(thresholds) &&
    thresholds.length > 0 &&
    thresholds.every((threshold, index) =>
      threshold &&
      (threshold.maxMs === null ||
        (Number.isFinite(threshold.maxMs) && threshold.maxMs >= 0)) &&
      Number.isFinite(threshold.score) &&
      threshold.score >= 0 &&
      threshold.score <= 100 &&
      (index === 0 ||
        (
          thresholds[index - 1].maxMs !== null &&
          (threshold.maxMs === null ||
            threshold.maxMs > thresholds[index - 1].maxMs) &&
          threshold.score <= thresholds[index - 1].score
        )),
    ) &&
    thresholds.at(-1).maxMs === null

  if (!valid) {
    throw new Error(
      `${environmentName} must be a JSON array of { "maxMs": number|null, "score": 0..100 } entries, with increasing limits, non-increasing scores, and a final null limit.`,
    )
  }

  return Object.freeze(
    thresholds.map((threshold) => Object.freeze({ ...threshold })),
  )
}

export const RESILIENCE_TIME_SCORE_THRESHOLDS = Object.freeze({
  recovery: loadTimeScoreThresholds(
    'CHAOSGUARD_RECOVERY_SCORE_THRESHOLDS',
  ),
  detection: loadTimeScoreThresholds(
    'CHAOSGUARD_DETECTION_SCORE_THRESHOLDS',
  ),
})

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
      Math.round((healthyDurationMs / validObservedDurationMs) * 10000) / 100,
    reason: null,
  }
}

function scoreDuration(durationMs, thresholds) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null
  return thresholds.find(
    ({ maxMs }) => maxMs === null || durationMs <= maxMs,
  )?.score ?? null
}

export function scoreRecovery(
  experiment,
  thresholds = RESILIENCE_TIME_SCORE_THRESHOLDS.recovery,
) {
  const inferredTimings =
    inferReadinessTimings(experiment)
  const inferredRecovery =
    experiment.recoveryTimeMs === null ||
    experiment.recoveryTimeMs === undefined
      ? inferredTimings.recoveryTimeMs
      : null

  return scoreDuration(
    experiment.recoveryTimeMs ?? inferredRecovery,
    thresholds,
  )
}

export function scoreDetection(
  experiment,
  thresholds = RESILIENCE_TIME_SCORE_THRESHOLDS.detection,
) {
  const inferredTimings =
    inferReadinessTimings(experiment)
  const inferredDetection =
    experiment.detectionTimeMs === null ||
    experiment.detectionTimeMs === undefined
      ? inferredTimings.detectionTimeMs
      : null

  return scoreDuration(
    experiment.detectionTimeMs ?? inferredDetection,
    thresholds,
  )
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

  if (errorRatePercent <= 0.1) return 100
  if (errorRatePercent <= 1) return 80
  if (errorRatePercent <= 5) return 60
  if (errorRatePercent <= 10) return 30
  return 0
}

function getMissingMetricReasons(experiment, scoreBreakdown) {
  const reasons = {}
  const status = experiment.status

  if (scoreBreakdown.recovery === null) {
    reasons.recovery =
      status === 'detection-timeout'
        ? 'Recovery was not observed because failure detection timed out.'
        : 'No valid recovery duration was recorded for this experiment.'
  }

  if (scoreBreakdown.detection === null) {
    reasons.detection =
      'No valid detection duration was recorded for this experiment.'
  }

  if (scoreBreakdown.availability === null) {
    reasons.availability =
      experiment.availabilityMeasurement?.reason ||
      'No trustworthy timestamped Kubernetes readiness measurement was recorded for this experiment.'
  }

  if (scoreBreakdown.stability === null) {
    reasons.stability =
      experiment.type === 'pod-failure'
        ? measurePodStability(experiment).reason
        : 'Pod restart counts were not available before and after the experiment.'
  }

  return reasons
}

export function calculateResilienceScore(experiment) {
  const scoreBreakdown = {
    recovery: scoreRecovery(experiment),
    detection: scoreDetection(experiment),
    availability:
      experiment.availabilityMeasurement?.status === 'measured'
        ? experiment.type === 'pod-failure'
          ? scorePodFailureAvailability(experiment.availabilityMeasurement)
          : scoreAvailability(
              experiment.availabilityMeasurement.availabilityPercent,
            )
        : null,
    stability: scoreStability(experiment),
  }

  const availableMetrics = Object.entries(scoreBreakdown)
    .filter(([, score]) => score !== null)

  const availableWeight = availableMetrics.reduce(
    (total, [metric]) => total + RESILIENCE_SCORE_WEIGHTS[metric],
    0,
  )
  const weightedTotal = availableMetrics.reduce(
    (total, [metric, score]) =>
      total + score * RESILIENCE_SCORE_WEIGHTS[metric],
    0,
  )
  const effectiveScoreWeights = Object.fromEntries(
    availableMetrics.map(([metric]) => [
      metric,
      Math.round((RESILIENCE_SCORE_WEIGHTS[metric] / availableWeight) * 10000) /
        100,
    ]),
  )
  const statusAllowsScore =
    experiment.status === 'completed' ||
    experiment.status === 'detection-timeout' ||
    experiment.status === 'recovery-timeout'
  const resilienceScore =
    statusAllowsScore &&
    availableMetrics.length >= 2
      ? Math.round((weightedTotal / availableWeight) * 10) / 10
      : null

  const missingMetricReasons =
    getMissingMetricReasons(experiment, scoreBreakdown)
  const insufficientStatus =
    !statusAllowsScore
  let scoreStatus

  if (insufficientStatus) {
    scoreStatus = 'incomplete-experiment'
  } else if (availableMetrics.length < 2) {
    scoreStatus = 'insufficient-metrics'
  } else if (availableMetrics.length < Object.keys(scoreBreakdown).length) {
    scoreStatus = 'partial-real-metrics'
  } else {
    scoreStatus = 'complete-real-metrics'
  }

  return {
    resilienceScore,
    scoreBreakdown,
    scoreWeights: RESILIENCE_SCORE_WEIGHTS,
    scoreThresholdsMs: {
      recovery: RESILIENCE_TIME_SCORE_THRESHOLDS.recovery,
      detection: RESILIENCE_TIME_SCORE_THRESHOLDS.detection,
    },
    availableWeightPercent: availableWeight,
    effectiveScoreWeights,
    scoreStatus,
    scoreUnavailableReason: insufficientStatus
      ? `An overall score is not reported while experiment status is "${experiment.status || 'unknown'}".`
      : availableMetrics.length < 2
        ? 'At least two valid measured metrics are required.'
        : null,
    missingMetrics: Object.keys(missingMetricReasons),
    missingMetricReasons,
    scoreMeasurements: {
      recoveryTimeMs:
        getScoreMeasurementDuration(
          experiment.recoveryTimeMs,
          inferReadinessTimings(experiment).recoveryTimeMs,
        ),
      detectionTimeMs:
        getScoreMeasurementDuration(
          experiment.detectionTimeMs,
          inferReadinessTimings(experiment).detectionTimeMs,
        ),
      availabilityPercent: meanAvailabilityPercent(
        experiment.availabilityMeasurement,
      ),
      availabilityMeasurement:
        experiment.availabilityMeasurement || null,
      readinessObservationCount:
        experiment.availabilityMeasurement?.validSampleCount ?? 0,
      restartCountDelta:
        experiment.type === 'pod-failure'
          ? measurePodStability(experiment).restartCountDelta
          : getRestartCountDelta(experiment),
      podStabilityMeasurement:
        experiment.type === 'pod-failure'
          ? measurePodStability(experiment)
          : null,
      metricMeasurementStatus: {
        recovery:
          getScoreMeasurementDuration(
            experiment.recoveryTimeMs,
            inferReadinessTimings(experiment).recoveryTimeMs,
          ) === null
            ? 'unavailable'
            : 'measured',
        detection:
          getScoreMeasurementDuration(
            experiment.detectionTimeMs,
            inferReadinessTimings(experiment).detectionTimeMs,
          ) === null
            ? 'unavailable'
            : 'measured',
        availability:
          experiment.availabilityMeasurement?.status || 'unavailable',
        stability:
          experiment.type === 'pod-failure'
            ? measurePodStability(experiment).status
            : Number.isSafeInteger(getRestartCountDelta(experiment))
              ? 'measured'
              : 'unavailable',
      },
      podRestartCount:
        Number.isSafeInteger(experiment.podRestartCount) &&
        experiment.podRestartCount >= 0
          ? experiment.podRestartCount
          : null,
      errorRatePercent:
        experiment.errorRateMeasurement?.status === 'measured' &&
        Number.isFinite(
          experiment.errorRateMeasurement.errorRatePercent,
        ) &&
        experiment.errorRateMeasurement.errorRatePercent >= 0 &&
        experiment.errorRateMeasurement.errorRatePercent <= 100
          ? experiment.errorRateMeasurement.errorRatePercent
          : null,
      errorRateMeasurement:
        experiment.errorRateMeasurement || null,
    },
  }
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
