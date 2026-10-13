import test from 'node:test'
import assert from 'node:assert/strict'
import {
  measureReadinessRecovery,
  measureResourceRecovery,
  measureStressDetection,
  parseCpuQuantity,
  parseMemoryQuantity,
  utilizationPercent,
} from '../stress-metrics.mjs'

test('Kubernetes CPU quantities are converted to cores', () => {
  assert.equal(parseCpuQuantity('250m'), 0.25)
  assert.equal(parseCpuQuantity('1500m'), 1.5)
  assert.equal(parseCpuQuantity('2'), 2)
  assert.equal(parseCpuQuantity(''), null)
  assert.equal(parseCpuQuantity('invalid'), null)
  assert.equal(parseCpuQuantity(-1), null)
})

test('Kubernetes memory quantities are converted to bytes', () => {
  assert.equal(parseMemoryQuantity('1Ki'), 1024)
  assert.equal(parseMemoryQuantity('2Gi'), 2 * 1024 ** 3)
  assert.equal(parseMemoryQuantity('1.5M'), 1_500_000)
  assert.equal(parseMemoryQuantity('invalid'), null)
  assert.equal(parseMemoryQuantity(-1), null)
})

test('utilization uses measured usage and a valid positive capacity', () => {
  assert.equal(utilizationPercent(0.5, 2), 25)
  assert.equal(utilizationPercent(0, 2), 0)
  assert.equal(utilizationPercent(3, 2), 150)
  assert.equal(utilizationPercent(1, 0), null)
  assert.equal(utilizationPercent(null, 2), null)
})

test('resource recovery requires consecutive real readings within baseline tolerance', async () => {
  let clock = 0
  const readings = [120, 105, 110]
  let index = 0
  const result = await measureResourceRecovery({
    resource: 'memory',
    baseline: 100,
    timeoutMs: 20,
    intervalMs: 5,
    consecutiveSamples: 2,
    now: () => clock,
    wait: async (duration) => { clock += duration },
    sample: async () => ({ memoryBytes: readings[index++] }),
  })

  assert.equal(result.status, 'measured')
  assert.equal(result.recoveryTimeMs, 10)
  assert.ok(Math.abs(result.recoveryLimit - 110) < Number.EPSILON * 128)
  assert.equal(result.consecutiveSamples, 2)
})

test('resource recovery returns unavailable when real readings do not recover before timeout', async () => {
  let clock = 0
  const result = await measureResourceRecovery({
    resource: 'cpu',
    baseline: 0.5,
    timeoutMs: 10,
    intervalMs: 5,
    now: () => clock,
    wait: async (duration) => { clock += duration },
    sample: async () => ({ cpuCores: 1 }),
  })

  assert.equal(result.status, 'unavailable')
  assert.equal(result.recoveryTimeMs, null)
  assert.match(result.reason, /did not observe cpu usage/)
})

test('readiness recovery requires consecutive post-event healthy observations', async () => {
  let clock = 1000
  const readyPods = [0, 1, 1]
  const result = await measureReadinessRecovery({
    afterTimestamp: new Date(1000).toISOString(),
    timeoutMs: 30,
    intervalMs: 5,
    now: () => clock,
    wait: async (duration) => { clock += duration },
    sample: async () => {
      clock += 1
      return {
        readyPods: readyPods.shift(),
        totalPods: 1,
        recordedAt: new Date(clock).toISOString(),
      }
    },
  })

  assert.equal(result.status, 'measured')
  assert.equal(result.recoveryTimeMs, 13)
  assert.equal(result.healthySamplesRequired, 2)
})

test('readiness recovery timeout has no fabricated recovery duration', async () => {
  let clock = 1000
  const result = await measureReadinessRecovery({
    afterTimestamp: new Date(1000).toISOString(),
    timeoutMs: 10,
    intervalMs: 5,
    now: () => clock,
    wait: async (duration) => { clock += duration },
    sample: async () => {
      clock += 1
      return {
        readyPods: 0,
        totalPods: 1,
        recordedAt: new Date(clock).toISOString(),
      }
    },
  })

  assert.equal(result.status, 'recovery-timeout')
  assert.equal(result.recoveryTimeMs, null)
  assert.match(result.reason, /consecutive healthy readiness observations/)
})

test('stress detection requires an observed zero-ready condition during the workload', () => {
  const start = Date.parse('2026-10-10T10:00:00.000Z')
  const result = measureStressDetection({
    readyBefore: true,
    startedAt: new Date(start).toISOString(),
    stressEndedAt: new Date(start + 10000).toISOString(),
    completedAt: new Date(start + 15000).toISOString(),
    readinessSamples: [
      {
        readyPods: 0,
        totalPods: 1,
        recordedAt: new Date(start + 12000).toISOString(),
      },
      {
        readyPods: 0,
        totalPods: 1,
        recordedAt: new Date(start + 5000).toISOString(),
      },
    ],
  })

  assert.equal(result.status, 'measured')
  assert.equal(result.detectionTimeMs, 5000)
  assert.equal(result.unhealthyCondition, 'zero-ready-pods')
})

test('stress detection timeout or no observed failure remains unmeasured', () => {
  const noFailure = measureStressDetection({
    readyBefore: true,
    startedAt: '2026-10-10T10:00:00.000Z',
    stressEndedAt: '2026-10-10T10:00:10.000Z',
    completedAt: '2026-10-10T10:00:15.000Z',
    readinessSamples: [
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:00:05.000Z',
      },
      {
        readyPods: 0,
        totalPods: 1,
        recordedAt: '2026-10-10T10:00:12.000Z',
      },
    ],
  })

  assert.equal(noFailure.status, 'not-detected')
  assert.equal(noFailure.detectionTimeMs, null)

  const invalidBaseline = measureStressDetection({
    readyBefore: false,
    startedAt: '2026-10-10T10:00:00.000Z',
    completedAt: '2026-10-10T10:00:15.000Z',
    readinessSamples: [],
  })
  assert.equal(invalidBaseline.status, 'unavailable')
  assert.equal(invalidBaseline.detectionTimeMs, null)
})

test('memory stress detection uses observed OOM and restart conditions', () => {
  const startedAt = '2026-10-10T10:00:00.000Z'
  const result = measureStressDetection({
    type: 'memory-stress',
    readyBefore: true,
    startedAt,
    stressEndedAt: '2026-10-10T10:00:10.000Z',
    completedAt: '2026-10-10T10:00:15.000Z',
    readinessSamples: [
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T09:59:59.000Z',
        podRestartCounts: [{ podId: 'pod-1', restartCount: 2 }],
      },
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:00:04.000Z',
        podRestartCounts: [{ podId: 'pod-1', restartCount: 3 }],
        oomKilledContainers: [
          {
            podId: 'pod-1',
            containerName: 'user-service',
            restartCount: 3,
            finishedAt: '2026-10-10T10:00:03.500Z',
            reason: 'OOMKilled',
          },
        ],
      },
    ],
  })

  assert.equal(result.status, 'measured')
  assert.equal(result.detectionTimeMs, 4000)
  assert.equal(result.unhealthyCondition, 'oom-killed-container')
  assert.equal(result.detectedAt, '2026-10-10T10:00:04.000Z')
})

test('memory stress ignores stale OOM state and does not infer detection from high utilization', () => {
  const result = measureStressDetection({
    type: 'memory-stress',
    readyBefore: true,
    startedAt: '2026-10-10T10:00:00.000Z',
    stressEndedAt: '2026-10-10T10:00:10.000Z',
    completedAt: '2026-10-10T10:00:15.000Z',
    memoryUtilizationPercent: 99,
    readinessSamples: [
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:00:05.000Z',
        podRestartCounts: [{ podId: 'pod-1', restartCount: 3 }],
        oomKilledContainers: [
          {
            podId: 'pod-1',
            containerName: 'user-service',
            restartCount: 3,
            finishedAt: '2026-10-10T09:59:59.000Z',
            reason: 'OOMKilled',
          },
        ],
      },
    ],
  })

  assert.equal(result.status, 'not-detected')
  assert.equal(result.detectionTimeMs, null)
})

test('CPU stress detection uses timestamped unhealthy HTTP observations and baseline target', () => {
  const result = measureStressDetection({
    type: 'cpu-stress',
    readyBefore: true,
    startedAt: '2026-10-10T10:00:00.000Z',
    stressEndedAt: '2026-10-10T10:00:10.000Z',
    completedAt: '2026-10-10T10:00:12.000Z',
    baselineResponseTimeMeasurement: {
      status: 'measured',
      responseTimeMs: 100,
    },
    httpTrafficProbeMeasurement: {
      responseSamples: [
        {
          statusCode: 200,
          responseTimeMs: 110,
          recordedAt: '2026-10-10T10:00:03.000Z',
        },
        {
          statusCode: 200,
          responseTimeMs: 125,
          recordedAt: '2026-10-10T10:00:04.000Z',
        },
        {
          statusCode: 503,
          responseTimeMs: 90,
          recordedAt: '2026-10-10T10:00:05.000Z',
        },
      ],
    },
    readinessSamples: [
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:00:01.000Z',
      },
    ],
  })

  assert.equal(result.status, 'measured')
  assert.equal(result.detectionTimeMs, 4000)
  assert.equal(result.unhealthyCondition, 'response-time-degradation')
})

test('stress detection ignores response observations outside the active window', () => {
  const result = measureStressDetection({
    type: 'cpu-stress',
    readyBefore: true,
    startedAt: '2026-10-10T10:00:00.000Z',
    stressEndedAt: '2026-10-10T10:00:10.000Z',
    completedAt: '2026-10-10T10:00:12.000Z',
    baselineResponseTimeMeasurement: {
      status: 'measured',
      responseTimeMs: 100,
    },
    httpTrafficProbeMeasurement: {
      responseSamples: [
        {
          statusCode: 503,
          responseTimeMs: 90,
          recordedAt: '2026-10-10T10:00:11.000Z',
        },
      ],
    },
  })

  assert.equal(result.status, 'not-detected')
  assert.equal(result.detectionTimeMs, null)
})
