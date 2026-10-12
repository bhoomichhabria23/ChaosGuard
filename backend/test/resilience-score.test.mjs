import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateResilienceScore,
  measureAvailability,
  measurePodStability,
  scoreAvailability,
  scoreDetection,
  scoreErrorRate,
  scoreRecovery,
  scoreStability,
} from '../resilience-score.mjs'

test('recovery thresholds distinguish fast, slow, invalid, and failed recovery', () => {
  assert.equal(scoreRecovery({ recoveryTimeMs: 1000 }), 100)
  assert.equal(scoreRecovery({ recoveryTimeMs: 3000 }), 90)
  assert.equal(scoreRecovery({ recoveryTimeMs: 5000 }), 80)
  assert.equal(scoreRecovery({ recoveryTimeMs: 10000 }), 60)
  assert.equal(scoreRecovery({ recoveryTimeMs: 20000 }), 40)
  assert.equal(scoreRecovery({ recoveryTimeMs: 20001 }), 20)
  assert.equal(scoreRecovery({ recoveryTimeMs: -1 }), null)
  assert.equal(
    scoreRecovery({ status: 'recovery-timeout', recoveryTimeMs: null }),
    null,
  )
  assert.equal(scoreRecovery({ recoveryTimeMs: 4000 }, [
    { maxMs: 1000, score: 95 },
    { maxMs: null, score: 35 },
  ]), 35)
})

test('detection thresholds distinguish fast, slow, invalid, and failed detection', () => {
  assert.equal(scoreDetection({ detectionTimeMs: 1000 }), 100)
  assert.equal(scoreDetection({ detectionTimeMs: 3000 }), 90)
  assert.equal(scoreDetection({ detectionTimeMs: 5000 }), 80)
  assert.equal(scoreDetection({ detectionTimeMs: 10000 }), 60)
  assert.equal(scoreDetection({ detectionTimeMs: 20000 }), 40)
  assert.equal(scoreDetection({ detectionTimeMs: 20001 }), 20)
  assert.equal(scoreDetection({ detectionTimeMs: -1 }), null)
  assert.equal(
    scoreDetection({ status: 'detection-timeout', detectionTimeMs: null }),
    null,
  )
})

test('availability score equals the measured percentage and rejects invalid observations', () => {
  assert.equal(scoreAvailability(100), 100)
  assert.equal(scoreAvailability(99), 99)
  assert.equal(scoreAvailability(96), 96)
  assert.equal(scoreAvailability(53.7), 53.7)
  assert.equal(scoreAvailability(101), null)
  assert.equal(scoreAvailability(null), null)
  const measured = measureAvailability({
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T00:00:02.000Z',
    readinessSamples: [
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
      { readyPods: 0, totalPods: 1, recordedAt: '2026-01-01T00:00:01.000Z' },
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:02.000Z' },
    ],
  })
  assert.equal(measured.status, 'measured')
  assert.equal(measured.availabilityPercent, 50)
  assert.equal(measured.validObservedDurationMs, 2000)
  assert.equal(measured.monitoringCoveragePercent, 100)
  assert.equal(measured.validSampleCount, 3)
  assert.equal(measured.healthySampleCount, 2)
  assert.equal(scoreAvailability(measured.availabilityPercent), 50)
  assert.equal(
    measureAvailability({
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-01-01T00:00:04.000Z',
      readinessSamples: [
        { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
        { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:04.000Z' },
      ],
    }).status,
    'insufficient-coverage',
  )
  assert.equal(
    measureAvailability({
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-01-01T00:00:01.000Z',
      readinessSamples: [
        { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
      ],
    }).status,
    'insufficient-samples',
  )
  const invalidWindow = measureAvailability({
    windowStart: 'invalid',
    windowEnd: '2026-01-01T00:00:01.000Z',
    readinessSamples: [
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:01.000Z' },
    ],
  })
  assert.equal(invalidWindow.status, 'unavailable')
  assert.equal(invalidWindow.availabilityPercent, null)
  const conflictingDuplicate = measureAvailability({
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T00:00:02.000Z',
    readinessSamples: [
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
      { readyPods: 0, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:01.000Z' },
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:02.000Z' },
    ],
  })
  assert.equal(conflictingDuplicate.status, 'insufficient-coverage')
  assert.equal(conflictingDuplicate.validSampleCount, 2)
  assert.equal(
    measureAvailability({
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-01-01T00:00:02.000Z',
      readinessSamples: [
        { readyPods: 0, totalPods: 0, recordedAt: '2026-01-01T00:00:00.000Z' },
        { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:01.000Z' },
        { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:02.000Z' },
      ],
    }).status,
    'insufficient-coverage',
  )
  assert.equal(
    scoreStability({ restartCountBefore: 2, restartCountAfter: 3 }),
    70,
  )
  assert.equal(
    scoreStability({ restartCountBefore: 3, restartCountAfter: 2 }),
    null,
  )
  assert.equal(scoreStability({ podRestartCount: 4 }), 0)
  assert.equal(
    scoreStability({ restartCountBefore: 0.5, restartCountAfter: 1.5 }),
    null,
  )
  assert.equal(scoreStability({}), null)
})

test('pod-failure stability counts the confirmed failed-pod replacement separately from restarts', () => {
  const experiment = {
    type: 'pod-failure',
    status: 'completed',
    podName: 'user-service-old',
    failedPodUid: 'old-pod-uid',
    failureObservation: { observed: true, reason: 'pod-absent' },
    replacementPodName: 'user-service-new',
    replacementPodUid: 'new-pod-uid',
    readinessSamples: [
      { podRestartCounts: [{ podId: 'survivor-uid', restartCount: 0 }] },
      { podRestartCounts: [{ podId: 'survivor-uid', restartCount: 0 }] },
    ],
  }

  const measurement = measurePodStability(experiment)
  assert.equal(measurement.status, 'measured')
  assert.equal(measurement.restartCountDelta, 0)
  assert.equal(measurement.failureEventCount, 1)
  assert.equal(measurement.podReplacementObserved, true)
  assert.equal(measurement.disruptionCount, 1)
  assert.equal(scoreStability(experiment), 70)
})

test('pod-failure stability uses restart observations from the same pod only', () => {
  const experiment = {
    type: 'pod-failure',
    status: 'completed',
    podName: 'deleted-target',
    failedPodUid: 'old-pod-uid',
    failureObservation: { observed: true, reason: 'pod-absent' },
    replacementPodName: 'replacement',
    replacementPodUid: 'replacement-pod-uid',
    restartCountBefore: 4,
    restartCountAfter: 0,
    readinessSamples: [
      {
        podRestartCounts: [{ podId: 'old-pod-uid', restartCount: 4 }],
      },
      {
        podRestartCounts: [{ podId: 'replacement-pod-uid', restartCount: 0 }],
      },
      {
        podRestartCounts: [{ podId: 'replacement-pod-uid', restartCount: 1 }],
      },
    ],
  }

  assert.equal(scoreStability(experiment), 40)
  assert.deepEqual(measurePodStability(experiment), {
    status: 'measured',
    restartCountDelta: 1,
    comparablePodCount: 1,
    source: 'kubernetes-api-pod-observations',
    failedPodName: 'deleted-target',
    failedPodUid: 'old-pod-uid',
    failureObserved: true,
    replacementCandidatePodName: null,
    replacementCandidatePodUid: null,
    replacementCandidatePodReady: null,
    failureEventCount: 1,
    podReplacementObserved: true,
    disruptionCount: 2,
    restartMeasurementStatus: 'measured',
    reason: null,
    failureReason: 'pod-absent',
    replacementPodName: 'replacement',
    replacementPodUid: 'replacement-pod-uid',
  })
  assert.equal(
    calculateResilienceScore({
      ...experiment,
      status: 'detection-timeout',
    }).scoreMeasurements.restartCountDelta,
    1,
  )
})

test('pod-failure stability remains unscored without comparable pod observations', () => {
  const experiment = {
    type: 'pod-failure',
    status: 'recovery-timeout',
    podName: 'deleted-target',
    failedPodUid: 'old-pod-uid',
    failureObservation: { observed: true, reason: 'deletion-timestamp' },
    restartCountBefore: 0,
    restartCountAfter: 0,
    podRestartCount: null,
    readinessSamples: [
      {
        podRestartCounts: [{ podId: 'old-pod-uid', restartCount: 0 }],
      },
      {
        podRestartCounts: [{ podId: 'replacement-pod-uid', restartCount: 0 }],
      },
    ],
  }
  const result = calculateResilienceScore({
    ...experiment,
    status: 'detection-timeout',
  })

  assert.equal(result.scoreBreakdown.stability, 70)
  assert.equal(result.scoreMeasurements.restartCountDelta, null)
  assert.equal(result.missingMetrics.includes('stability'), false)

  assert.equal(
    scoreStability({
      type: 'pod-failure',
      failureObservation: { observed: true, reason: 'pod-absent' },
      podRestartCount: 0,
      readinessSamples: [
        { podRestartCounts: [] },
        { podRestartCounts: [] },
      ],
    }),
    70,
  )
  assert.equal(
    scoreStability({
      type: 'pod-failure',
      failureObservation: { observed: true, reason: 'pod-absent' },
      podRestartCount: 0,
    }),
    70,
  )
})

test('Pod Failure score accounts for readiness coverage and the real pod replacement', () => {
  const result = calculateResilienceScore({
    type: 'pod-failure',
    status: 'completed',
    recoveryTimeMs: 8278,
    detectionTimeMs: 92,
    podName: 'user-service-old',
    failedPodUid: 'old-pod-uid',
    failureObservation: { observed: true, reason: 'pod-absent' },
    replacementPodName: 'user-service-new',
    replacementPodUid: 'new-pod-uid',
    readinessSamples: [
      { podRestartCounts: [{ podId: 'survivor-uid', restartCount: 0 }] },
      { podRestartCounts: [{ podId: 'survivor-uid', restartCount: 0 }] },
    ],
    availabilityMeasurement: {
      status: 'measured',
      availabilityPercent: 100,
      monitoringCoveragePercent: 99.62,
      healthyDurationMs: 8300,
      validObservedDurationMs: 8300,
    },
  })

  assert.deepEqual(result.scoreBreakdown, {
    recovery: 60,
    detection: 100,
    availability: 99.62,
    stability: 70,
  })
  assert.equal(result.resilienceScore, 81.4)
  assert.equal(result.scoreMeasurements.availabilityPercent, 100)
  assert.equal(
    result.scoreMeasurements.availabilityMeasurement.monitoringCoveragePercent,
    99.62,
  )
  assert.equal(result.scoreMeasurements.podStabilityMeasurement.restartCountDelta, 0)
  assert.equal(result.scoreMeasurements.podStabilityMeasurement.disruptionCount, 1)
})

test('pod-failure stability uses dynamic service and pod identities across all services', () => {
  const targets = [
    'user-service',
    'order-service',
    'payment-service',
    'notification-service',
  ]

  for (const target of targets) {
    const experiment = {
      type: 'pod-failure',
      target,
      status: 'completed',
      podName: `${target}-selected-random-pod`,
      failedPodUid: `${target}-deleted-uid`,
      failureObservation: {
        observed: true,
        reason: 'deletion-timestamp',
      },
      replacementPodName: `${target}-replacement-random-pod`,
      replacementPodUid: `${target}-replacement-uid`,
      readinessSamples: [
        {
          podRestartCounts: [
            { podId: `${target}-deleted-uid`, restartCount: 3 },
            { podId: `${target}-survivor-uid`, restartCount: 1 },
          ],
        },
        {
          podRestartCounts: [
            { podId: `${target}-replacement-uid`, restartCount: 0 },
            { podId: `${target}-survivor-uid`, restartCount: 2 },
          ],
        },
      ],
    }
    const measurement = measurePodStability(experiment)
    assert.equal(measurement.status, 'measured', target)
    assert.equal(measurement.restartCountDelta, 1, target)
    assert.equal(measurement.comparablePodCount, 1, target)
    assert.equal(measurement.failedPodName, experiment.podName, target)
    assert.equal(
      measurement.replacementPodName,
      experiment.replacementPodName,
      target,
    )
    assert.equal(scoreStability(experiment), 40, target)
  }
})

test('error-rate thresholds reject unmeasured and invalid values', () => {
  assert.equal(scoreErrorRate(0.1), 100)
  assert.equal(scoreErrorRate(1), 80)
  assert.equal(scoreErrorRate(5), 60)
  assert.equal(scoreErrorRate(10), 30)
  assert.equal(scoreErrorRate(10.1), 0)
  assert.equal(scoreErrorRate(null), null)
  assert.equal(scoreErrorRate(-0.1), null)
  assert.equal(scoreErrorRate(100.1), null)
})

test('configured weights follow the four-metric resilience formula', () => {
  const result = calculateResilienceScore({
    status: 'completed',
    recoveryTimeMs: 500,
    detectionTimeMs: 8000,
    availabilityMeasurement: {
      status: 'measured',
      availabilityPercent: 40,
    },
    restartCountBefore: 0,
    restartCountAfter: 1,
    errorRateMeasurement: {
      status: 'measured',
      errorRatePercent: 0,
    },
  })

  assert.equal(result.resilienceScore, 70.5)
  assert.deepEqual(result.scoreBreakdown, {
    recovery: 100,
    detection: 60,
    availability: 40,
    stability: 70,
  })
  assert.deepEqual(result.scoreWeights, {
    recovery: 35,
    detection: 25,
    availability: 25,
    stability: 15,
  })
  assert.deepEqual(result.effectiveScoreWeights, {
    recovery: 35,
    detection: 25,
    availability: 25,
    stability: 15,
  })
  assert.equal(result.scoreStatus, 'complete-real-metrics')
})

test('partial scores normalize available configured weights and omit unavailable metrics', () => {
  const result = calculateResilienceScore({
    status: 'completed',
    recoveryTimeMs: 500,
    detectionTimeMs: 8000,
  })

  assert.equal(result.resilienceScore, 83.3)
  assert.deepEqual(result.scoreBreakdown, {
    recovery: 100,
    detection: 60,
    availability: null,
    stability: null,
  })
  assert.equal(result.scoreWeights.recovery, 35)
  assert.equal(result.scoreWeights.detection, 25)
  assert.deepEqual(result.effectiveScoreWeights, {
    recovery: 58.33,
    detection: 41.67,
  })
  assert.equal(result.scoreStatus, 'partial-real-metrics')
  assert.deepEqual(result.missingMetrics, [
    'availability',
    'stability',
  ])
  assert.equal(result.availableWeightPercent, 60)
})

test('insufficient measured metrics return a null score', () => {
  const result = calculateResilienceScore({
    status: 'completed',
    detectionTimeMs: 500,
  })

  assert.equal(result.resilienceScore, null)
  assert.equal(result.scoreStatus, 'insufficient-metrics')
})

test('missing timeout durations are unavailable rather than fabricated zero scores', () => {
  const detectionFailure = calculateResilienceScore({
    status: 'detection-timeout',
    recoveryTimeMs: null,
    detectionTimeMs: null,
    availabilityMeasurement: { status: 'measured', availabilityPercent: 100 },
    podRestartCount: 0,
  })
  const recoveryFailure = calculateResilienceScore({
    status: 'recovery-timeout',
    recoveryTimeMs: null,
    detectionTimeMs: 500,
    availabilityMeasurement: { status: 'measured', availabilityPercent: 100 },
    podRestartCount: 0,
  })

  assert.equal(detectionFailure.scoreBreakdown.detection, null)
  assert.equal(recoveryFailure.scoreBreakdown.recovery, null)
})

test('legacy timeout scores timing from recorded readiness transitions', () => {
  const result = calculateResilienceScore({
    type: 'pod-failure',
    status: 'detection-timeout',
    startedAt: '2026-10-10T10:29:42.223Z',
    completedAt: '2026-10-10T10:29:56.079Z',
    detectionTimeMs: null,
    recoveryTimeMs: null,
    readinessSamples: [
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:48.488Z',
      },
      {
        readyPods: 0,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:50.207Z',
      },
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:56.079Z',
      },
    ],
  })

  assert.equal(result.scoreBreakdown.detection, 60)
  assert.equal(result.scoreBreakdown.recovery, 60)
  assert.equal(result.scoreMeasurements.detectionTimeMs, 7984)
  assert.equal(result.scoreMeasurements.recoveryTimeMs, 5872)
})

test('incomplete experiment statuses do not receive an overall score', () => {
  const failed = calculateResilienceScore({
    status: 'failed',
    detectionTimeMs: 100,
    recoveryTimeMs: 100,
    availabilityMeasurement: { status: 'measured', availabilityPercent: 100 },
    restartCountBefore: 0,
    restartCountAfter: 0,
    errorRateMeasurement: { status: 'measured', errorRatePercent: 0 },
  })

  assert.deepEqual(Object.values(failed.scoreBreakdown), [100, 100, 100, 100])
  assert.equal(failed.resilienceScore, null)
  assert.equal(failed.scoreStatus, 'incomplete-experiment')
  assert.match(failed.scoreUnavailableReason, /status is "failed"/)
})

test('CPU and memory samples remain separate from unmeasured timing metrics', () => {
  const cpuResult = calculateResilienceScore({
    type: 'cpu-stress',
    status: 'completed',
    cpuSamples: [{ cpu: 0.9, recordedAt: '2026-01-01T00:00:00.000Z' }],
    availabilityMeasurement: { status: 'measured', availabilityPercent: 100 },
    restartCountBefore: 0,
    restartCountAfter: 0,
  })
  const memoryResult = calculateResilienceScore({
    type: 'memory-stress',
    status: 'completed',
    memorySamples: [
      { memoryBytes: 1048576, recordedAt: '2026-01-01T00:00:00.000Z' },
    ],
    availabilityMeasurement: { status: 'measured', availabilityPercent: 100 },
    restartCountBefore: 0,
    restartCountAfter: 0,
  })

  for (const result of [cpuResult, memoryResult]) {
    assert.equal(result.scoreBreakdown.availability, 100)
    assert.equal(result.scoreBreakdown.stability, 100)
    assert.equal(result.scoreMeasurements.detectionTimeMs, null)
    assert.equal(result.scoreMeasurements.recoveryTimeMs, null)
    assert.deepEqual(result.scoreBreakdown, {
      recovery: null,
      detection: null,
      availability: 100,
      stability: 100,
    })
  }
})

test('invalid negative durations are unavailable rather than scored', () => {
  const result = calculateResilienceScore({
    status: 'completed',
    detectionTimeMs: -5,
    recoveryTimeMs: -10,
    availabilityMeasurement: { status: 'measured', availabilityPercent: 100 },
  })

  assert.equal(result.scoreBreakdown.detection, null)
  assert.equal(result.scoreBreakdown.recovery, null)
  assert.equal(result.scoreMeasurements.detectionTimeMs, null)
  assert.equal(result.scoreMeasurements.recoveryTimeMs, null)
  assert.equal(result.resilienceScore, null)
})
