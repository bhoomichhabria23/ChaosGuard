import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findRecoveredReplacementPod,
  inferReadinessTimings,
  isPodReady,
  observeTargetPodFailure,
  isTargetPodFailureObserved,
} from '../pod-failure-observations.mjs'

function pod(name, { ready = true, phase = 'Running', deleting = false } = {}) {
  return {
    metadata: {
      name,
      ...(deleting ? { deletionTimestamp: '2026-10-10T10:00:00.000Z' } : {}),
    },
    status: {
      phase,
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
    },
  }
}

test('target failure is detected from its disappearance or Kubernetes state', () => {
  assert.equal(isPodReady(pod('target')), true)
  assert.equal(isTargetPodFailureObserved([], 'target'), true)
  assert.equal(
    isTargetPodFailureObserved([pod('target', { ready: false })], 'target'),
    true,
  )
  assert.equal(
    isTargetPodFailureObserved([pod('target', { deleting: true })], 'target'),
    true,
  )
  assert.equal(isTargetPodFailureObserved([pod('target')], 'target'), false)
})

test('failure observations retain real state and pod UID for the selected pod', () => {
  const deleting = pod('random-target', { deleting: true })
  deleting.metadata.uid = 'selected-target-uid'
  assert.deepEqual(
    observeTargetPodFailure([deleting], 'random-target'),
    {
      observed: true,
      reason: 'deletion-timestamp',
      podUid: 'selected-target-uid',
    },
  )
  assert.deepEqual(
    observeTargetPodFailure([pod('survivor')], 'random-target'),
    { observed: true, reason: 'pod-absent' },
  )
  assert.deepEqual(
    observeTargetPodFailure([pod('random-target')], 'random-target'),
    {
      observed: false,
      reason: 'still-ready',
      podUid: null,
    },
  )
})

test('recovery waits until ready capacity is restored on a replacement pod', () => {
  const oldPod = pod('old')
  const replacement = pod('replacement')
  const survivor = pod('survivor')
  survivor.metadata.uid = 'survivor-uid'

  assert.equal(findRecoveredReplacementPod([replacement], 'old', 2), null)
  assert.equal(findRecoveredReplacementPod([oldPod], 'old', 1), null)
  assert.equal(
    findRecoveredReplacementPod([oldPod, replacement], 'old', 2),
    replacement,
  )
  assert.equal(
    findRecoveredReplacementPod(
      [survivor, replacement],
      'old',
      2,
      ['survivor-uid'],
    ),
    replacement,
  )
})

test('readiness timestamps provide real timings when legacy detection timed out', () => {
  const timings = inferReadinessTimings({
    type: 'pod-failure',
    startedAt: '2026-10-10T10:29:42.223Z',
    completedAt: '2026-10-10T10:30:07.820Z',
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
      {
        readyPods: 0,
        totalPods: 1,
        recordedAt: '2026-10-10T10:30:07.820Z',
      },
    ],
  })

  assert.equal(timings.detectionTimeMs, 7984)
  assert.equal(timings.recoveryTimeMs, 5872)
})

test('readiness timings require observed healthy-to-unhealthy and unhealthy-to-healthy transitions', () => {
  const timings = inferReadinessTimings({
    type: 'pod-failure',
    startedAt: '2026-10-10T10:29:42.223Z',
    completedAt: '2026-10-10T10:29:44.223Z',
    readinessSamples: [
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:42.223Z',
      },
      {
        readyPods: 0,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:44.223Z',
      },
    ],
  })

  assert.equal(timings.detectionTimeMs, 2000)
  assert.equal(timings.recoveryTimeMs, null)
})

test('readiness timing inference rejects observations outside the experiment window', () => {
  const timings = inferReadinessTimings({
    type: 'pod-failure',
    startedAt: '2026-10-10T10:29:42.223Z',
    completedAt: '2026-10-10T10:29:45.000Z',
    readinessSamples: [
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:42.223Z',
      },
      {
        readyPods: 0,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:46.000Z',
      },
      {
        readyPods: 1,
        totalPods: 1,
        recordedAt: '2026-10-10T10:29:47.000Z',
      },
    ],
  })

  assert.equal(timings.detectionTimeMs, null)
  assert.equal(timings.recoveryTimeMs, null)
})
