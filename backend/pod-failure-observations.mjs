export function isPodReady(pod) {
  if (
    !pod ||
    pod.status?.phase !== 'Running'
  ) {
    return false
  }

  const readyCondition =
    pod.status?.conditions?.find(
      (condition) => condition.type === 'Ready',
    )

  return readyCondition?.status === 'True'
}

export function describePodFailureExecutionError(
  error,
  failureInjectionAttempted = false,
) {
  const causeCode = error?.cause?.code || error?.code || null
  const message =
    error instanceof Error ? error.message : String(error)
  const isFetchFailure =
    message.toLowerCase() === 'fetch failed' ||
    typeof causeCode === 'string' &&
      ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(
        causeCode,
      )

  if (!isFetchFailure) {
    return {
      statusCode: 500,
      error: 'Failed to execute pod failure experiment',
      details: message,
    }
  }

  const transportDetail = causeCode
    ? ` (${causeCode})`
    : ''
  const injectionDetail = failureInjectionAttempted
    ? ' The pod deletion request was sent but its outcome could not be confirmed; inspect the pod in Kubernetes before retrying.'
    : ''
  return {
    statusCode: 503,
    error: 'Kubernetes API connection failed',
    details:
      `The ChaosGuard backend could not complete a request to the Kubernetes API${transportDetail}. Verify the backend kubeconfig and network access to the cluster.${injectionDetail}`,
  }
}

export function isTargetPodFailureObserved(pods, podName) {
  return observeTargetPodFailure(pods, podName).observed
}

export function observeTargetPodFailure(pods, podName) {
  const targetPod = pods.find((pod) => pod.metadata?.name === podName)
  if (!targetPod) return { observed: true, reason: 'pod-absent' }
  if (targetPod.metadata?.deletionTimestamp) {
    return {
      observed: true,
      reason: 'deletion-timestamp',
      podUid: targetPod.metadata?.uid || null,
    }
  }
  if (
    targetPod.status?.phase === 'Succeeded' ||
    targetPod.status?.phase === 'Failed'
  ) {
    return {
      observed: true,
      reason: 'terminal-phase',
      podUid: targetPod.metadata?.uid || null,
    }
  }
  if (!isPodReady(targetPod)) {
    return {
      observed: true,
      reason: 'not-ready',
      podUid: targetPod.metadata?.uid || null,
    }
  }
  return {
    observed: false,
    reason: 'still-ready',
    podUid: targetPod.metadata?.uid || null,
  }
}

export function findRecoveredReplacementPod(
  pods,
  oldPodName,
  expectedReadyPodCount,
  initialPodIds = [],
) {
  const readyPods =
    pods.filter(isPodReady)

  if (readyPods.length < expectedReadyPodCount) {
    return null
  }

  return (
    readyPods.find(
      (pod) =>
        pod.metadata?.name !== oldPodName &&
        !initialPodIds.includes(
          pod.metadata?.uid || pod.metadata?.name,
        ),
    ) || null
  )
}

export function inferReadinessTimings(experiment) {
  if (
    experiment.type !== 'pod-failure' ||
    !Array.isArray(experiment.readinessSamples)
  ) {
    return { detectionTimeMs: null, recoveryTimeMs: null }
  }

  const experimentStartedAt = Date.parse(experiment.startedAt)
  const failureInjectedAt = Date.parse(experiment.failureInjectedAt)
  const startedAt = Number.isFinite(failureInjectedAt)
    ? failureInjectedAt
    : experimentStartedAt
  const completedAt = Date.parse(experiment.completedAt)
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt
  ) {
    return { detectionTimeMs: null, recoveryTimeMs: null }
  }

  const observations = experiment.readinessSamples
    .map((sample) => ({
      timestamp: Date.parse(sample?.recordedAt),
      readyPods: sample?.readyPods,
      totalPods: sample?.totalPods,
    }))
    .filter(({ timestamp, readyPods, totalPods }) =>
      Number.isFinite(timestamp) &&
      timestamp >= startedAt &&
      timestamp <= completedAt &&
      Number.isSafeInteger(readyPods) &&
      readyPods >= 0 &&
      Number.isSafeInteger(totalPods) &&
      totalPods > 0 &&
      readyPods <= totalPods,
    )
    .sort((left, right) => left.timestamp - right.timestamp)

  let sawHealthy = false
  let firstFailureAt = null
  let recoveredAt = null

  for (const observation of observations) {
    if (firstFailureAt === null) {
      if (observation.readyPods > 0) {
        sawHealthy = true
      } else if (sawHealthy) {
        firstFailureAt = observation.timestamp
      }
    } else if (recoveredAt === null && observation.readyPods > 0) {
      recoveredAt = observation.timestamp
      break
    }
  }

  return {
    detectionTimeMs:
      sawHealthy &&
      firstFailureAt !== null &&
      Number.isFinite(startedAt) &&
      firstFailureAt >= startedAt
        ? firstFailureAt - startedAt
        : null,
    recoveryTimeMs:
      firstFailureAt !== null &&
      recoveredAt !== null &&
      recoveredAt >= startedAt
        ? recoveredAt - startedAt
        : null,
  }
}
