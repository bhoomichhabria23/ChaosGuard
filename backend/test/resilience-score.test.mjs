import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateResilienceScore,
  getResilienceScoreTargets,
  measureAvailability,
  scoreAvailability,
  scoreDetection,
  scoreErrorRate,
  scorePerformance,
  scoreRecovery,
} from '../resilience-score.mjs'

function completeExperiment(overrides = {}) {
  return {
    type: 'cpu-stress',
    status: 'completed',
    readyBefore: true,
    availabilityMeasurement: {
      status: 'measured',
      availabilityPercent: 96,
      monitoringCoveragePercent: 100,
    },
    responseTimeMeasurement: {
      status: 'measured',
      baselineResponseTimeMs: 250,
      averageResponseTimeMs: 1250,
      reason: null,
    },
    errorRateMeasurement: {
      status: 'measured',
      totalRequests: 100,
      successfulRequests: 90,
      failedRequests: 5,
      clientErrorRequests: 5,
    },
    detectionMeasurement: {
      status: 'measured',
      detectionTimeMs: 10000,
      source: 'kubernetes-api-pod-readiness',
    },
    recoveryMeasurement: {
      status: 'measured',
      recoveryTimeMs: 20000,
      source: 'kubernetes-api-pod-readiness',
    },
    ...overrides,
  }
}

test('availability is based on valid timestamped readiness checks and coverage', () => {
  const measurement = measureAvailability({
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T00:00:02.000Z',
    readinessSamples: [
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
      { readyPods: 0, totalPods: 1, recordedAt: '2026-01-01T00:00:01.000Z' },
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:02.000Z' },
    ],
  })
  assert.equal(measurement.status, 'measured')
  assert.equal(measurement.availabilityPercent, 66.67)
  assert.equal(measurement.validObservedDurationMs, 2000)
  assert.equal(measurement.monitoringCoveragePercent, 100)
  assert.equal(scoreAvailability(0), 0)
  assert.equal(scoreAvailability(100), 100)
  assert.equal(scoreAvailability(101), null)

  const insufficientCoverage = measureAvailability({
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T00:00:04.000Z',
    readinessSamples: [
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:00.000Z' },
      { readyPods: 1, totalPods: 1, recordedAt: '2026-01-01T00:00:04.000Z' },
    ],
  })
  assert.equal(insufficientCoverage.status, 'insufficient-coverage')
  assert.equal(insufficientCoverage.availabilityPercent, null)
})

test('performance and time scores use measured baselines and configured targets', () => {
  assert.equal(scorePerformance({
    baselineResponseTimeMs: 100,
    averageResponseTimeMs: 120,
  }), 100)
  assert.equal(scorePerformance({
    baselineResponseTimeMs: 100,
    averageResponseTimeMs: 200,
  }), 60)
  assert.equal(scorePerformance({
    baselineResponseTimeMs: null,
    averageResponseTimeMs: 100,
  }), null)
  assert.equal(scoreDetection({ detectionTimeMs: 500 }), 100)
  assert.equal(scoreDetection({ detectionTimeMs: 2000 }), 50)
  assert.equal(scoreRecovery({ recoveryTimeMs: 10000 }), 50)
  assert.equal(scoreDetection({ detectionTimeMs: 0 }), null)
  assert.equal(scoreDetection({ detectionTimeMs: -1 }), null)
  assert.equal(scoreRecovery({ recoveryTimeMs: null }), null)
  assert.equal(scoreRecovery({ status: 'recovery-timeout', recoveryTimeMs: 10000 }), null)
  assert.equal(scoreDetection({ status: 'detection-timeout', detectionTimeMs: 500 }), null)
  assert.equal(scoreErrorRate(10), 90)
  assert.equal(scoreErrorRate(100), 0)
  assert.equal(scoreErrorRate(-1), null)
})

test('score targets are configurable and invalid values are rejected', () => {
  const original = {
    response: process.env.CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT,
    detection: process.env.CHAOSGUARD_DETECTION_TARGET_MS,
    recovery: process.env.CHAOSGUARD_RECOVERY_TARGET_MS,
  }
  try {
    process.env.CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT = '35'
    process.env.CHAOSGUARD_DETECTION_TARGET_MS = '4000'
    process.env.CHAOSGUARD_RECOVERY_TARGET_MS = '9000'
    assert.deepEqual(getResilienceScoreTargets(), {
      responseTimeDegradationTolerancePercent: 35,
      detectionTimeMs: 4000,
      recoveryTimeMs: 9000,
    })
    process.env.CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT = '0'
    assert.equal(
      getResilienceScoreTargets().responseTimeDegradationTolerancePercent,
      0,
    )
    process.env.CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT = '-1'
    assert.throws(getResilienceScoreTargets, /non-negative percentage/)
    process.env.CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT = '20'
    process.env.CHAOSGUARD_RECOVERY_TARGET_MS = '0'
    assert.throws(getResilienceScoreTargets, /must be configured as a positive/)
  } finally {
    for (const [key, value] of [
      ['CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT', original.response],
      ['CHAOSGUARD_DETECTION_TARGET_MS', original.detection],
      ['CHAOSGUARD_RECOVERY_TARGET_MS', original.recovery],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('moderate stress uses all five real component measurements and returns a percentage score', () => {
  const result = calculateResilienceScore(completeExperiment())
  assert.deepEqual(result.scoreBreakdown, {
    availability: 96,
    performance: 24,
    errorHandling: 90,
    detection: 10,
    recovery: 25,
  })
  assert.equal(result.resilienceScore, 49)
  assert.equal(result.scoreStatus, 'complete-real-metrics')
  assert.deepEqual(result.scoreWeights, {
    availability: 20,
    performance: 20,
    errorHandling: 20,
    detection: 20,
    recovery: 20,
  })
  assert.equal(result.scoreMeasurements.baselineResponseTimeMs, 250)
  assert.equal(result.scoreMeasurements.acceptableResponseTimeMs, 300)
  assert.equal(result.scoreMeasurements.responseTimeDegradationPercent, 400)
  assert.equal(result.scoreMeasurements.successfulRequests, 90)
  assert.equal(result.scoreMeasurements.totalRequests, 100)
})

test('normal operation scores from real passing measurements, not hardcoded experiment type values', () => {
  const result = calculateResilienceScore(completeExperiment({
    type: 'memory-stress',
    availabilityMeasurement: { status: 'measured', availabilityPercent: 100 },
    responseTimeMeasurement: {
      status: 'measured',
      baselineResponseTimeMs: 80,
      averageResponseTimeMs: 100,
    },
    errorRateMeasurement: {
      status: 'measured',
      successfulRequests: 30,
      totalRequests: 30,
    },
    detectionMeasurement: { status: 'measured', detectionTimeMs: 1000 },
    recoveryMeasurement: { status: 'measured', recoveryTimeMs: 2000 },
  }))
  assert.equal(result.resilienceScore, 99.2)
  assert.deepEqual(Object.values(result.scoreBreakdown), [100, 96, 100, 100, 100])
})

test('severe stress lowers the score only through measured service impact and timing', () => {
  const result = calculateResilienceScore(completeExperiment({
    availabilityMeasurement: { status: 'measured', availabilityPercent: 20 },
    responseTimeMeasurement: {
      status: 'measured',
      baselineResponseTimeMs: 100,
      averageResponseTimeMs: 5000,
    },
    errorRateMeasurement: {
      status: 'measured',
      successfulRequests: 20,
      totalRequests: 100,
    },
    detectionMeasurement: { status: 'measured', detectionTimeMs: 25000 },
    recoveryMeasurement: { status: 'measured', recoveryTimeMs: 50000 },
    cpuUtilizationPercent: 100,
    memoryUtilizationPercent: 100,
  }))
  assert.deepEqual(result.scoreBreakdown, {
    availability: 20,
    performance: 2.4,
    errorHandling: 20,
    detection: 4,
    recovery: 10,
  })
  assert.equal(result.resilienceScore, 11.28)
})

test('high CPU or memory usage alone does not alter the service resilience score', () => {
  const healthy = completeExperiment()
  const highUtilization = completeExperiment({
    cpuUtilizationPercent: 100,
    memoryUtilizationPercent: 150,
  })
  assert.equal(
    calculateResilienceScore(highUtilization).resilienceScore,
    calculateResilienceScore(healthy).resilienceScore,
  )
})

test('Pod Failure uses the same score components and keeps detection separate from recovery', () => {
  const result = calculateResilienceScore(completeExperiment({
    type: 'pod-failure',
    detectionMeasurement: {
      status: 'measured',
      detectionTimeMs: 1000,
      source: 'kubernetes-api-target-pod-observation',
    },
    recoveryMeasurement: {
      status: 'measured',
      recoveryTimeMs: 10000,
      source: 'kubernetes-api-pod-readiness',
    },
  }))
  assert.deepEqual(Object.keys(result.scoreBreakdown), [
    'availability',
    'performance',
    'errorHandling',
    'detection',
    'recovery',
  ])
  assert.equal(result.scoreBreakdown.detection, 100)
  assert.equal(result.scoreBreakdown.recovery, 50)
  assert.equal(result.scoreMeasurements.detectionTimeMs, 1000)
  assert.equal(result.scoreMeasurements.recoveryTimeMs, 10000)
  assert.equal(result.resilienceScore, 72)
})

test('reported Pod Failure measurements produce baseline-relative and stricter timing scores', () => {
  const result = calculateResilienceScore(completeExperiment({
    type: 'pod-failure',
    availabilityMeasurement: {
      status: 'measured',
      availabilityPercent: 100,
    },
    responseTimeMeasurement: {
      status: 'measured',
      baselineResponseTimeMs: 22,
      averageResponseTimeMs: 38.29,
    },
    errorRateMeasurement: {
      status: 'measured',
      totalRequests: 9.37,
      successfulRequests: 9.37,
    },
    detectionMeasurement: {
      status: 'measured',
      detectionTimeMs: 118,
    },
    recoveryMeasurement: {
      status: 'measured',
      recoveryTimeMs: 9319,
    },
  }))
  assert.deepEqual(result.scoreBreakdown, {
    availability: 100,
    performance: 68.95,
    errorHandling: 100,
    detection: 100,
    recovery: 53.65,
  })
  assert.equal(result.resilienceScore, 84.52)
  assert.equal(result.scoreMeasurements.acceptableResponseTimeMs, 26.4)
})

test('detection and recovery timeouts never become fabricated measured scores', () => {
  const detectionTimeout = calculateResilienceScore(completeExperiment({
    type: 'pod-failure',
    status: 'detection-timeout',
    detectionMeasurement: {
      status: 'not-detected',
      detectionTimeMs: null,
      reason: 'No detection before timeout.',
    },
    recoveryMeasurement: {
      status: 'unavailable',
      recoveryTimeMs: null,
      reason: 'Detection timed out.',
    },
  }))
  assert.equal(detectionTimeout.scoreBreakdown.detection, null)
  assert.equal(detectionTimeout.scoreBreakdown.recovery, null)
  assert.equal(detectionTimeout.resilienceScore, null)
  assert.equal(detectionTimeout.scoreStatus, 'incomplete-experiment')

  const recoveryTimeout = calculateResilienceScore(completeExperiment({
    type: 'pod-failure',
    status: 'recovery-timeout',
    detectionMeasurement: { status: 'measured', detectionTimeMs: 500 },
    recoveryMeasurement: {
      status: 'recovery-timeout',
      recoveryTimeMs: null,
      reason: 'Service recovery timed out.',
    },
  }))
  assert.equal(recoveryTimeout.scoreBreakdown.recovery, null)
  assert.equal(recoveryTimeout.resilienceScore, null)
})

test('missing or invalid measurements do not receive substitute scores', () => {
  const missing = calculateResilienceScore(completeExperiment({
    responseTimeMeasurement: {
      status: 'unavailable',
      baselineResponseTimeMs: null,
      averageResponseTimeMs: null,
      reason: 'Probe disabled.',
    },
    errorRateMeasurement: { status: 'no-traffic', totalRequests: 0 },
    detectionMeasurement: {
      status: 'not-detected',
      reason: 'No unhealthy condition was observed.',
    },
  }))
  assert.equal(missing.scoreBreakdown.performance, null)
  assert.equal(missing.scoreBreakdown.errorHandling, null)
  assert.equal(missing.scoreBreakdown.detection, null)
  assert.equal(missing.resilienceScore, null)
  assert.deepEqual(missing.missingMetrics, [
    'performance',
    'errorHandling',
    'detection',
  ])
  assert.match(missing.missingMetricReasons.performance, /Probe disabled/)

  const invalidTime = calculateResilienceScore(completeExperiment({
    detectionMeasurement: { status: 'measured', detectionTimeMs: 0 },
    recoveryMeasurement: { status: 'measured', recoveryTimeMs: -10 },
  }))
  assert.equal(invalidTime.scoreBreakdown.detection, null)
  assert.equal(invalidTime.scoreBreakdown.recovery, null)
  assert.equal(invalidTime.resilienceScore, null)
})

test('incomplete stress experiment retains measured component evidence but has no overall score', () => {
  const result = calculateResilienceScore(completeExperiment({
    status: 'measurement-incomplete',
  }))
  assert.equal(result.scoreBreakdown.availability, 96)
  assert.equal(result.resilienceScore, null)
  assert.equal(result.scoreStatus, 'incomplete-experiment')
})
