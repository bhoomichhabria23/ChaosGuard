import { createServer } from 'node:http'
import {
  createHash,
  randomUUID,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto'
import {
  access,
  mkdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { Writable } from 'node:stream'
import * as k8s from '@kubernetes/client-node'
import axios from 'axios'
import {
  calculateResilienceScore,
  measureAvailability,
} from './resilience-score.mjs'
import {
  buildHttpErrorRateQueries,
  createErrorRateMeasurement,
} from './prometheus-observations.mjs'
import { createHttpTrafficProbe } from './http-traffic-probe.mjs'
import {
  findRecoveredReplacementPod,
  isPodReady,
  observeTargetPodFailure,
} from './pod-failure-observations.mjs'

const port = Number(
  process.env.PORT || 4174
)
const frontendOrigin = (
  process.env.FRONTEND_ORIGIN || ''
).trim().replace(/\/+$/, '')
const prometheusUrl = (
  process.env.PROMETHEUS_URL || 'http://localhost:9090'
).replace(/\/+$/, '')

const dataDirectory =
  join(
    process.cwd(),
    'data'
  )

const usersFile =
  join(
    dataDirectory,
    'users.json'
  )

const experimentsFile =
  join(
    dataDirectory,
    'experiments.json'
  )

const sessionsFile =
  join(
    dataDirectory,
    'sessions.json'
  )

const sessionLifetimeMs =
  24 * 60 * 60 * 1000

const scrypt =
  promisify(
    scryptCallback
  )

const services = []
const experiments = []
let experimentsLoaded = false
const sessions = new Map()
let sessionWriteQueue = Promise.resolve()

const kubeConfig =
  new k8s.KubeConfig()

kubeConfig.loadFromDefault()

const kubeApi =
  kubeConfig.makeApiClient(
    k8s.CoreV1Api
  )

const allowedChaosServices = [
  'user-service',
  'order-service',
  'payment-service',
  'notification-service'
]

const httpTrafficProbeTargets = {
  'user-service': {
    port: 3001,
    path: 'api/users',
  },
  'order-service': {
    port: 3002,
    path: 'api/orders',
  },
  'payment-service': {
    port: 3003,
    path: 'api/payments',
  },
  'notification-service': {
    port: 3004,
    path: 'api/notifications',
  },
}

function startHttpTrafficProbe(target) {
  const service = httpTrafficProbeTargets[target]
  if (!service) {
    throw new Error(`No HTTP traffic probe route is configured for ${target}`)
  }

  return createHttpTrafficProbe(async () => {
    try {
      const result =
        await kubeApi.connectGetNamespacedServiceProxyWithPathWithHttpInfo(
          {
            name: `http:${target}:${service.port}`,
            namespace: 'default',
            path: service.path,
          },
        )
      return result.httpStatusCode
    } catch (error) {
      if (Number.isInteger(error.code) && error.code >= 100 && error.code <= 599) {
        return error.code
      }
      throw error
    }
  })
}

function hasValidTrafficProbeOption(input) {
  return (
    input.enableHttpTrafficProbe === undefined ||
    typeof input.enableHttpTrafficProbe === 'boolean'
  )
}

/*
 * GENERAL HELPERS
 */

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  )
}

function createSilentWritable() {
  return new Writable({
    write(
      _chunk,
      _encoding,
      callback
    ) {
      callback()
    }
  })
}

async function loadExperiments() {
  if (experimentsLoaded) {
    return
  }

  try {
    const fileContents =
      await readFile(
        experimentsFile,
        'utf8'
      )

    const storedExperiments =
      JSON.parse(
        fileContents.replace(
          /^\uFEFF/,
          ''
        )
      )

    if (Array.isArray(storedExperiments)) {
      experiments.push(
        ...storedExperiments
      )
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }

    await mkdir(
      dirname(experimentsFile),
      {
        recursive: true
      }
    )

    await writeFile(
      experimentsFile,
      '[]',
      'utf8'
    )
  }

  experimentsLoaded = true
}

async function saveExperiments() {
  await mkdir(
    dirname(experimentsFile),
    {
      recursive: true
    }
  )

  await writeFile(
    experimentsFile,
    JSON.stringify(
      experiments,
      null,
      2
    ),
    'utf8'
  )
}

async function recordExperiment(
  request,
  experiment,
  trafficProbe = null
) {
  await loadExperiments()

  if (trafficProbe) {
    experiment.httpTrafficProbeMeasurement =
      await trafficProbe.stop()
  }

  experiment.availabilityMeasurement =
    measureAvailability({
      readinessSamples: experiment.readinessSamples,
      windowStart: experiment.startedAt,
      windowEnd: experiment.completedAt,
    })
  experiment.errorRateMeasurement =
    await collectErrorRateMeasurement(experiment)

  Object.assign(
    experiment,
    calculateResilienceScore(experiment)
  )

  const user =
    await getSessionUser(
      request,
      await loadUsers()
    )

  experiments.unshift({
    ...experiment,
    userId:
      user?.id || null
  })

  await saveExperiments()

  return experiment
}

async function collectErrorRateMeasurement(experiment) {
  const windowStart = experiment.startedAt
  const windowEnd = experiment.completedAt
  const startMs = Date.parse(windowStart)
  const endMs = Date.parse(windowEnd)
  const windowMs = endMs - startMs
  const base = {
    target: experiment.target,
    windowStart,
    windowEnd,
    sampleCount: 0,
    totalRequests: null,
    failedRequests: null,
    clientErrorRequests: null,
    monitoringCoveragePercent: null,
  }

  if (
    !allowedChaosServices.includes(experiment.target) ||
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    windowMs <= 0
  ) {
    return createErrorRateMeasurement(base)
  }

  try {
    const queries = buildHttpErrorRateQueries(
      experiment.target,
      windowMs,
    )
    const queryAtEnd = async (query) => {
      const response = await axios.get(
        `${prometheusUrl}/api/v1/query`,
        {
          params: {
            query,
            time: endMs / 1000,
          },
          timeout: 5000,
        },
      )
      if (response.data?.status !== 'success') {
        throw new Error(
          response.data?.error || 'Prometheus query did not succeed',
        )
      }
      const value = response.data?.data?.result?.[0]?.value?.[1]
      return value === undefined ? null : Number(value)
    }

    const [
      sampleCount,
      totalRequests,
      failedRequests,
      clientErrorRequests,
      coverageResponse,
    ] =
      await Promise.all([
        queryAtEnd(queries.sampleCount),
        queryAtEnd(queries.totalRequests),
        queryAtEnd(queries.failedRequests),
        queryAtEnd(queries.clientErrorRequests),
        axios.get(`${prometheusUrl}/api/v1/query_range`, {
          params: {
            query: queries.scrapeCoverage,
            start: startMs / 1000,
            end: endMs / 1000,
            step: '1s',
          },
          timeout: 5000,
        }),
      ])

    if (coverageResponse.data?.status !== 'success') {
      throw new Error(
        coverageResponse.data?.error ||
          'Prometheus scrape-coverage query did not succeed',
      )
    }
    const coveredTimestamps = new Set()
    for (const series of coverageResponse.data?.data?.result || []) {
      for (const [timestamp, value] of series.values || []) {
        if (Number(value) > 0) {
          coveredTimestamps.add(Math.round(Number(timestamp) * 1000))
        }
      }
    }
    const coveredDurationMs = [...coveredTimestamps].reduce(
      (total, timestamp) =>
        total +
        Math.max(
          0,
          Math.min(1000, endMs - Math.max(startMs, timestamp)),
        ),
      0,
    )
    const monitoringCoveragePercent =
      Math.min(100, (coveredDurationMs / windowMs) * 100)

    return createErrorRateMeasurement({
      ...base,
      sampleCount: sampleCount ?? 0,
      totalRequests,
      failedRequests,
      clientErrorRequests,
      monitoringCoveragePercent,
    })
  } catch (error) {
    console.error(
      `Failed to query HTTP error-rate counters for ${experiment.target}:`,
      error,
    )
    return {
      ...createErrorRateMeasurement(base),
      status: 'unavailable',
      reason:
        `Prometheus HTTP counter query failed for the experiment window: ${error.message}`,
    }
  }
}

/*
 * PROMETHEUS READINESS
 */

async function getPodReadiness(
  target
) {
  const pods = await getPodsForService(target)
  return pods.some(isPodReady)
}

/*
 * KUBERNETES POD HELPERS
 */

async function getPodsForService(
  target
) {
  const response =
    await kubeApi.listNamespacedPod({
      namespace: 'default',
      labelSelector:
        `app=${target}`
    })

  return response.items || []
}

function getPodRestartCount(pod) {
  const containerStatuses =
    pod?.status?.containerStatuses

  if (
    !Array.isArray(containerStatuses) ||
    containerStatuses.length === 0
  ) {
    return null
  }

  const restartCounts =
    containerStatuses.map(
      (status) =>
        Number(status.restartCount)
    )

  return restartCounts.every(
    (count) =>
      Number.isSafeInteger(count) &&
      count >= 0
  )
    ? restartCounts.reduce(
        (total, count) =>
          total + count,
        0
      )
    : null
}

async function recordReadinessObservation(
  target,
  samples,
  expectedReplicaCount = 0
) {
  try {
    const pods =
      await getPodsForService(
        target
      )

    appendReadinessObservation(
      pods,
      samples,
      expectedReplicaCount
    )
  } catch (error) {
    console.error(
      `Failed to observe readiness for ${target}:`,
      error
    )
  }
}

function startReadinessSampling(
  target,
  samples,
  expectedReplicaCount,
  intervalMs = 500
) {
  let sampling = false
  const takeSample = async () => {
    if (sampling) return
    sampling = true
    try {
      await recordReadinessObservation(
        target,
        samples,
        expectedReplicaCount
      )
    } finally {
      sampling = false
    }
  }

  void takeSample()
  const timer = setInterval(
    () => void takeSample(),
    intervalMs
  )

  return async () => {
    clearInterval(timer)
    while (sampling) {
      await sleep(10)
    }
    await takeSample()
  }
}

function appendReadinessObservation(
  pods,
  samples,
  expectedReplicaCount = 0
) {
  const totalPods =
    expectedReplicaCount ||
    pods.length

  if (totalPods === 0) {
    samples.push({
      readyPods: 0,
      totalPods: 0,
      serviceHealthy: false,
      recordedAt:
        new Date().toISOString()
    })
    return
  }

  const readyPods =
    Math.min(
      pods.filter(isPodReady).length,
      totalPods
    )

  samples.push({
    readyPods,
    totalPods,
    serviceHealthy: readyPods > 0,
    podRestartCounts: pods.flatMap((pod) => {
      const podId =
        pod.metadata?.uid ||
        pod.metadata?.name
      const restartCount =
        getPodRestartCount(pod)

      return podId && restartCount !== null
        ? [{ podId, restartCount }]
        : []
    }),
    recordedAt:
      new Date().toISOString()
  })
}

async function getCurrentPodName(
  target
) {
  const pods =
    await getPodsForService(
      target
    )

  const runningPod =
    pods.find(
      (pod) =>
        pod.status?.phase ===
        'Running'
    )

  return (
    runningPod?.metadata?.name ||
    null
  )
}

/*
 * POD FAILURE DETECTION
 */

async function waitForPodDeletion(
  podName,
  target,
  readinessSamples,
  expectedReplicaCount,
  timeoutMs = 30000,
  intervalMs = 250,
  failureStartedAt = Date.now(),
) {
  while (
    Date.now() -
      failureStartedAt <
    timeoutMs
  ) {
    const pods =
      await getPodsForService(target)

    appendReadinessObservation(
      pods,
      readinessSamples,
      expectedReplicaCount,
    )

    const failureObservation =
      observeTargetPodFailure(pods, podName)
    if (failureObservation.observed) {
      return {
        success: true,
        elapsedMs:
          Date.now() -
          failureStartedAt,
        failureObservation,
      }
    }

    await sleep(
      intervalMs
    )
  }

  return {
    success: false,
    elapsedMs:
      Date.now() -
      failureStartedAt,
    failureObservation: {
      observed: false,
      reason: 'not-observed-before-timeout',
    },
  }
}

async function waitForReplacementPod(
  target,
  oldPodName,
  readinessSamples,
  expectedReplicaCount,
  expectedReadyPodCount,
  initialPodIds,
  timeoutMs = 60000,
  intervalMs = 500
) {
  const startedWaiting =
    Date.now()
  let replacementCandidate = null

  while (
    Date.now() -
      startedWaiting <
    timeoutMs
  ) {
    const pods =
      await getPodsForService(
        target
      )

    appendReadinessObservation(
      pods,
      readinessSamples,
      expectedReplicaCount
    )

    const replacementCandidates =
      pods.filter((candidate) => {
        const candidateId =
          candidate.metadata?.uid ||
          candidate.metadata?.name
        return (
          candidate.metadata?.name !== oldPodName &&
          !initialPodIds.includes(candidateId)
        )
      })
    replacementCandidate =
      replacementCandidates.find(isPodReady) ||
      replacementCandidates[0] ||
      replacementCandidate

    const replacementPod =
      findRecoveredReplacementPod(
        pods,
        oldPodName,
        expectedReadyPodCount,
        initialPodIds,
      )

    if (
      replacementPod
    ) {
      return {
        success: true,
        elapsedMs:
          Date.now() -
          startedWaiting,
        podName:
          replacementPod
            .metadata.name,
        podUid:
          replacementPod.metadata?.uid || null,
        candidatePodName:
          replacementPod.metadata?.name || null,
        candidatePodUid:
          replacementPod.metadata?.uid || null,
        candidatePodReady: true,
        podRestartCount:
          getPodRestartCount(
            replacementPod
          )
      }
    }

    await sleep(
      intervalMs
    )
  }

  return {
    success: false,
    elapsedMs:
      Date.now() -
      startedWaiting,
    podName: null,
    podUid: null,
    candidatePodName:
      replacementCandidate?.metadata?.name || null,
    candidatePodUid:
      replacementCandidate?.metadata?.uid || null,
    candidatePodReady:
      replacementCandidate
        ? isPodReady(replacementCandidate)
        : null,
    podRestartCount: null
  }
}

/*
 * CPU METRICS
 *
 * Uses a 1-min Prometheus
 * rate so that the CPU measurement
 * reacts faster to the stress workload.
 */

async function getPodCpuUsage(
  target
) {
  const podName =
    await getCurrentPodName(
      target
    )

  if (!podName) {
    return null
  }

  return getPodCpuUsageByPod(
    podName
  )
}

async function getPodCpuUsageByPod(
  podName
) {
  const query =
    `rate(container_cpu_usage_seconds_total{namespace="default",pod="${podName}"}[1m])`

  const response =
    await axios.get(
      `${prometheusUrl}/api/v1/query`,
      {
        params: {
          query
        }
      }
    )

  const results =
    response.data?.data?.result ||
    []

  if (
    results.length === 0
  ) {
    return null
  }

  const cpu =
    Number(
      results[0].value[1]
    )

  return Number.isFinite(cpu)
    ? cpu
    : null
}

async function getServiceMetrics(
  target
) {
  const pods =
    await getPodsForService(
      target
    )

  const pod =
    pods.find(
      (item) =>
        item.status?.phase ===
        'Running'
    )

  const podName =
    pod?.metadata?.name || null

  if (!pod) {
    return {
      target,
      podName: null,
      cpuUsage: null,
      memoryMb: null,
      podStatus: null,
      ready: false,
      restartCount: null
    }
  }

  const containerName =
    await getTargetContainerName(
      target,
      podName
    )

  const [
    cpuUsage,
    memoryBytes
  ] = await Promise.all([
    getPodCpuUsageByPod(
      podName
    ),
    containerName
      ? getPodMemoryUsageByPod(
          podName,
          containerName
        )
      : Promise.resolve(null)
  ])

  return {
    target,
    podName,
    cpuUsage,
    memoryMb:
      memoryBytes === null
        ? null
        : memoryBytes /
          (1024 * 1024),
    podStatus:
      pod.status?.phase || null,
    ready:
      isPodReady(pod),
    restartCount:
      (pod.status?.containerStatuses || [])
        .reduce(
          (total, status) =>
            total +
            Number(
              status.restartCount || 0
            ),
          0
        )
  }
}

/*
 * RUN A REAL CPU WORKLOAD
 * INSIDE THE TARGET POD
 */

async function runCpuStress(
  target,
  podName,
  durationMs
) {
  const pods =
    await getPodsForService(
      target
    )

  const pod =
    pods.find(
      (item) =>
        item.metadata?.name ===
        podName
    )

  const containerName =
    pod?.spec?.containers?.[0]
      ?.name

  if (!containerName) {
    throw new Error(
      'Target container could not be determined'
    )
  }

  const durationSeconds =
    Math.max(
      1,
      Math.ceil(
        durationMs / 1000
      )
    )

  const command = [
    'node',
    '-e',
    `const end=Date.now()+${durationMs};while(Date.now()<end){Math.sqrt(Math.random()*1000000);}`
  ]

  const stdout =
    createSilentWritable()

  const stderr =
    createSilentWritable()

  const exec =
    new k8s.Exec(
      kubeConfig
    )

  await new Promise(
    (
      resolve,
      reject
    ) => {
      let completed = false

      const finishSuccess =
        () => {
          if (
            completed
          ) {
            return
          }

          completed = true
          resolve()
        }

      const finishFailure =
        (error) => {
          if (
            completed
          ) {
            return
          }

          completed = true
          reject(error)
        }

      try {
        const result =
          exec.exec(
            'default',
            podName,
            containerName,
            command,
            stdout,
            stderr,
            null,
            false,
            (status) => {
              if (
                status?.status ===
                'Failure'
              ) {
                finishFailure(
                  new Error(
                    `CPU stress command failed after ${durationSeconds}s`
                  )
                )
                return
              }

              finishSuccess()
            }
          )

        if (
          result &&
          typeof result.catch ===
            'function'
        ) {
          result.catch(
            finishFailure
          )
        }
      } catch (error) {
        finishFailure(
          error
        )
      }
    }
  )
}

/*
 * MEMORY METRICS
 *
 * Prometheus measures the target pod's
 * real working-set memory through cAdvisor.
 */

async function getTargetContainerName(
  target,
  podName
) {
  const pods =
    await getPodsForService(
      target
    )

  const pod =
    pods.find(
      (item) =>
        item.metadata?.name ===
        podName
    )

  return pod?.spec?.containers?.[0]
    ?.name || null
}

async function getPodMemoryUsageByPod(
  podName,
  containerName
) {
  const query =
    `container_memory_working_set_bytes{namespace="default",pod="${podName}"}`

  const response =
    await axios.get(
      `${prometheusUrl}/api/v1/query`,
      {
        params: {
          query
        }
      }
    )

  const results =
    response.data?.data?.result ||
    []

  if (
    results.length === 0
  ) {
    return null
  }

  const containerResults =
    results.filter(
      (result) =>
        result.metric?.container &&
        result.metric.container !==
          'POD' &&
        (!containerName ||
          result.metric.container ===
            containerName)
    )

  const measurements =
    containerResults.length > 0
      ? containerResults
      : results.filter(
          (result) =>
            result.metric?.container !==
            'POD'
        )

  const memoryBytes =
    measurements.reduce(
      (total, result) =>
        total +
        Number(
          result.value?.[1]
        ),
      0
    )

  return Number.isFinite(
    memoryBytes
  )
    ? memoryBytes
    : null
}

/*
 * RUN A REAL MEMORY WORKLOAD
 * INSIDE THE TARGET POD
 */

async function runMemoryStress(
  target,
  podName,
  durationMs,
  memoryMb
) {
  const containerName =
    await getTargetContainerName(
      target,
      podName
    )

  if (!containerName) {
    throw new Error(
      'Target container could not be determined'
    )
  }

  const safeMemoryMb =
    Math.min(
      Math.max(
        Number(memoryMb) || 256,
        64
      ),
      512
    )

  const memoryBytes =
    safeMemoryMb *
    1024 *
    1024

  const command = [
    'node',
    '-e',
    `const memory=Buffer.alloc(${memoryBytes},1);setTimeout(()=>console.log(memory.length),${durationMs});`
  ]

  const stdout =
    createSilentWritable()

  const stderr =
    createSilentWritable()

  const exec =
    new k8s.Exec(
      kubeConfig
    )

  await new Promise(
    (
      resolve,
      reject
    ) => {
      let completed = false

      const finishSuccess =
        () => {
          if (completed) {
            return
          }

          completed = true
          resolve()
        }

      const finishFailure =
        (error) => {
          if (completed) {
            return
          }

          completed = true
          reject(error)
        }

      try {
        const result =
          exec.exec(
            'default',
            podName,
            containerName,
            command,
            stdout,
            stderr,
            null,
            false,
            (status) => {
              if (
                status?.status ===
                'Failure'
              ) {
                finishFailure(
                  new Error(
                    `Memory stress command failed for ${safeMemoryMb} MB`
                  )
                )

                return
              }

              finishSuccess()
            }
          )

        if (
          result &&
          typeof result.catch ===
            'function'
        ) {
          result.catch(
            finishFailure
          )
        }
      } catch (error) {
        finishFailure(error)
      }
    }
  )
}

/*
 * AUTHENTICATION
 */

async function loadUsers() {
  try {
    await access(
      usersFile
    )

    const fileContents =
      await readFile(
        usersFile,
        'utf8'
      )

    return JSON.parse(
      fileContents.replace(
        /^\uFEFF/,
        ''
      )
    )
  } catch (error) {
    if (
      error.code !==
      'ENOENT'
    ) {
      throw error
    }

    await mkdir(
      dirname(usersFile),
      {
        recursive: true
      }
    )

    await writeFile(
      usersFile,
      '[]',
      'utf8'
    )

    return []
  }
}

async function saveUsers(
  users
) {
  await mkdir(
    dirname(usersFile),
    {
      recursive: true
    }
  )

  await writeFile(
    usersFile,
    JSON.stringify(
      users,
      null,
      2
    ),
    'utf8'
  )
}

async function hashPassword(
  password,
  salt = randomBytes(
    16
  ).toString('hex')
) {
  const derivedKey =
    await scrypt(
      password,
      salt,
      64
    )

  return `${salt}:${derivedKey.toString(
    'hex'
  )}`
}

async function verifyPassword(
  password,
  storedHash
) {
  const [
    salt,
    expectedHex
  ] =
    storedHash.split(':')

  if (
    !salt ||
    !expectedHex
  ) {
    return false
  }

  const actual =
    await scrypt(
      password,
      salt,
      64
    )

  const expected =
    Buffer.from(
      expectedHex,
      'hex'
    )

  return (
    expected.length ===
      actual.length &&
    timingSafeEqual(
      expected,
      actual
    )
  )
}

async function getSessionUser(
  request,
  users
) {
  const cookieHeader =
    request.headers.cookie ||
    ''

  const token =
    cookieHeader
      .split(';')
      .map(
        (cookie) =>
          cookie.trim()
      )
      .find(
        (cookie) =>
          cookie.startsWith(
            'session='
          )
      )

  if (!token) {
    return null
  }

  const sessionKey =
    createHash('sha256')
      .update(
        token.slice(
          'session='.length
        )
      )
      .digest('hex')

  if (!sessions.has(sessionKey)) {
    await restoreSessions()
  }

  const session = sessions.get(sessionKey)

  if (
    !session ||
    session.expiresAt <= Date.now()
  ) {
    sessions.delete(
      sessionKey
    )
    return null
  }

  return users.find(
    (user) =>
      user.id ===
      session.userId
  ) || null
}

async function restoreSessions() {
  let parsedSessions
  try {
    parsedSessions = JSON.parse(
      await readFile(
        sessionsFile,
        'utf8'
      )
    )
  } catch (error) {
    if (error.code === 'ENOENT') {
      return
    }
    throw error
  }

  if (!Array.isArray(parsedSessions)) {
    throw new Error('Stored authentication sessions must be a JSON array')
  }

  const now = Date.now()
  let needsSave = false
  for (const session of parsedSessions) {
    if (
      typeof session?.tokenHash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(session.tokenHash) ||
      typeof session.userId !== 'string' ||
      !Number.isFinite(session.expiresAt)
    ) {
      needsSave = true
      continue
    }

    if (session.expiresAt <= now) {
      needsSave = true
      continue
    }

    sessions.set(session.tokenHash, {
      userId: session.userId,
      expiresAt: session.expiresAt,
    })
  }

  if (needsSave) {
    await persistSessions()
  }
}

function persistSessions() {
  const snapshot = JSON.stringify(
    [...sessions.entries()].map(
      ([tokenHash, session]) => ({
        tokenHash,
        userId: session.userId,
        expiresAt: session.expiresAt,
      })
    ),
    null,
    2
  )

  const saveOperation =
    sessionWriteQueue.then(
      async () => {
        await mkdir(
          dirname(sessionsFile),
          { recursive: true }
        )
        const temporaryFile = `${sessionsFile}.tmp`
        await writeFile(
          temporaryFile,
          snapshot,
          { encoding: 'utf8', mode: 0o600 }
        )
        await rename(
          temporaryFile,
          sessionsFile
        )
      }
    )

  sessionWriteQueue =
    saveOperation.catch(
      () => {}
    )

  return saveOperation
}

function publicUser(
  user
) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt:
      user.createdAt
  }
}

/*
 * HTTP HELPERS
 */

function respond(
  response,
  status,
  body
) {
  response.writeHead(
    status,
    {
      'Content-Type':
        'application/json; charset=utf-8',
      'Cache-Control':
        'no-store'
    }
  )

  response.end(
    JSON.stringify(body)
  )
}

async function readBody(
  request
) {
  let rawBody = ''

  for await (
    const chunk of request
  ) {
    rawBody += chunk
  }

  return rawBody
    ? JSON.parse(rawBody)
    : {}
}

/*
 * SERVER
 */

const server =
  createServer(
    async (
      request,
      response
    ) => {
      const origin = request.headers.origin
      if (frontendOrigin && origin === frontendOrigin) {
        response.setHeader('Access-Control-Allow-Origin', frontendOrigin)
        response.setHeader('Access-Control-Allow-Credentials', 'true')
        response.setHeader('Vary', 'Origin')

        if (request.method === 'OPTIONS') {
          response.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              request.headers['access-control-request-headers'] || 'Content-Type',
            'Access-Control-Max-Age': '600',
          })
          response.end()
          return
        }
      }

      const url =
        new URL(
          request.url || '/',
          `http://${request.headers.host || 'localhost'}`
        )

      /*
       * HEALTH
       */

      if (
        request.method ===
          'GET' &&
        url.pathname ===
          '/api/health'
      ) {
        return respond(
          response,
          200,
          {
            status:
              'operational',
            timestamp:
              new Date().toISOString()
          }
        )
      }

      /*
       * PROMETHEUS MONITORING
       */

      if (
        request.method ===
          'GET' &&
        url.pathname.startsWith(
          '/api/monitoring/'
        )
      ) {
        try {
          const target =
            url.pathname.replace(
              '/api/monitoring/',
              ''
            )

          if (
            !allowedChaosServices.includes(
              target
            )
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'Invalid monitoring target'
              }
            )
          }

          const ready =
            await getPodReadiness(
              target
            )

          return respond(
            response,
            200,
            {
              service:
                target,
              ready,
              checkedAt:
                new Date().toISOString()
            }
          )
        } catch (error) {
          console.error(
            'Prometheus check failed:',
            error
          )

          return respond(
            response,
            500,
            {
              error:
                'Failed to query Prometheus',
              details:
                error.message
            }
          )
        }
      }

      /*
       * REGISTER
       */

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/api/auth/register'
      ) {
        try {
          const input =
            await readBody(
              request
            )

          const name =
            String(
              input.name || ''
            ).trim()

          const email =
            String(
              input.email || ''
            )
              .trim()
              .toLowerCase()

          const password =
            String(
              input.password || ''
            )

          if (
            !name ||
            !email ||
            !password
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'Name, email, and password are required'
              }
            )
          }

          if (
            password.length <
            8
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'Password must be at least 8 characters'
              }
            )
          }

          const users =
            await loadUsers()

          if (
            users.some(
              (user) =>
                user.email ===
                email
            )
          ) {
            return respond(
              response,
              409,
              {
                error:
                  'An account with that email already exists'
              }
            )
          }

          const user = {
            id: randomUUID(),
            name,
            email,
            passwordHash:
              await hashPassword(
                password
              ),
            createdAt:
              new Date().toISOString()
          }

          users.push(user)

          await saveUsers(
            users
          )

          return respond(
            response,
            201,
            {
              user:
                publicUser(
                  user
                )
            }
          )
        } catch (error) {
          console.error(
            'Registration failed:',
            error
          )

          return respond(
            response,
            400,
            {
              error:
                'Request body must be valid JSON'
            }
          )
        }
      }

      /*
       * LOGIN
       */

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/api/auth/login'
      ) {
        try {
          const input =
            await readBody(
              request
            )

          const email =
            String(
              input.email || ''
            )
              .trim()
              .toLowerCase()

          const password =
            String(
              input.password || ''
            )

          const users =
            await loadUsers()

          const user =
            users.find(
              (candidate) =>
                candidate.email ===
                email
            )

          if (
            !user ||
            !(await verifyPassword(
              password,
              user.passwordHash
            ))
          ) {
            return respond(
              response,
              401,
              {
                error:
                  'Invalid email or password'
              }
            )
          }

          const token =
            randomUUID()

          const sessionKey =
            createHash('sha256')
              .update(token)
              .digest('hex')

          sessions.set(
            sessionKey,
            {
              userId: user.id,
              expiresAt: Date.now() + sessionLifetimeMs,
            }
          )

          try {
            await persistSessions()
          } catch (error) {
            sessions.delete(sessionKey)
            console.error(
              'Unable to persist login session:',
              error
            )
            return respond(
              response,
              500,
              { error: 'Unable to establish a persistent session' }
            )
          }

          response.setHeader(
            'Set-Cookie',
            `session=${token}; HttpOnly; SameSite=${frontendOrigin ? 'None; Secure' : 'Lax'}; Path=/; Max-Age=${sessionLifetimeMs / 1000}`
          )

          return respond(
            response,
            200,
            {
              user:
                publicUser(
                  user
                )
            }
          )
        } catch (error) {
          console.error(
            'Login failed:',
            error
          )

          return respond(
            response,
            error instanceof SyntaxError ? 400 : 500,
            {
              error: error instanceof SyntaxError
                ? 'Request body must be valid JSON'
                : 'Unable to complete login'
            }
          )
        }
      }

      /*
       * LOGOUT
       */

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/api/auth/logout'
      ) {
        const cookieHeader =
          request.headers.cookie ||
          ''

        const token =
          cookieHeader
            .split(';')
            .map(
              (cookie) =>
                cookie.trim()
            )
            .find(
              (cookie) =>
                cookie.startsWith(
                  'session='
                )
            )
            ?.slice(
              'session='.length
            )

        if (token) {
          const sessionKey =
            createHash('sha256')
              .update(token)
              .digest('hex')
          const session = sessions.get(sessionKey)
          sessions.delete(sessionKey)
          try {
            await persistSessions()
          } catch (error) {
            if (session) {
              sessions.set(sessionKey, session)
            }
            console.error(
              'Unable to persist logout:',
              error
            )
            return respond(
              response,
              500,
              { error: 'Unable to complete logout' }
            )
          }
        }

        response.setHeader(
          'Set-Cookie',
          'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
        )

        return respond(
          response,
          200,
          {
            success: true
          }
        )
      }

      /*
       * UPDATE CURRENT USER PROFILE
       */

      if (
        request.method ===
          'PATCH' &&
        url.pathname ===
          '/api/auth/profile'
      ) {
        try {
          const users =
            await loadUsers()

          const user =
            await getSessionUser(
              request,
              users
            )

          if (!user) {
            return respond(
              response,
              401,
              {
                error:
                  'Authentication is required to update your profile'
              }
            )
          }

          let input

          try {
            input =
              await readBody(
                request
              )
          } catch {
            return respond(
              response,
              400,
              {
                error:
                  'Request body must be valid JSON'
              }
            )
          }

          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input)
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'Profile details must be provided as a JSON object'
              }
            )
          }

          const name =
            String(
              input.name || ''
            ).trim()

          const email =
            String(
              input.email || ''
            )
              .trim()
              .toLowerCase()

          if (!name || !email) {
            return respond(
              response,
              400,
              {
                error:
                  'Name and email are required'
              }
            )
          }

          if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
              email
            )
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'Enter a valid email address'
              }
            )
          }

          const emailInUse =
            users.some(
              (candidate) =>
                candidate.id !==
                  user.id &&
                String(
                  candidate.email || ''
                ).toLowerCase() ===
                  email
            )

          if (emailInUse) {
            return respond(
              response,
              409,
              {
                error:
                  'An account with that email already exists'
              }
            )
          }

          user.name = name
          user.email = email

          await saveUsers(users)

          return respond(
            response,
            200,
            {
              user:
                publicUser(user)
            }
          )
        } catch (error) {
          console.error(
            'Profile update failed:',
            error
          )

          return respond(
            response,
            500,
            {
              error:
                'Failed to update profile'
            }
          )
        }
      }

      /*
       * CURRENT USER
       */

      if (
        request.method ===
          'GET' &&
        url.pathname ===
          '/api/auth/me'
      ) {
        const user =
          await getSessionUser(
            request,
            await loadUsers()
          )

        return user
          ? respond(
              response,
              200,
              {
                user:
                  publicUser(
                    user
                  )
              }
            )
          : respond(
              response,
              401,
              {
                error:
                  'Not authenticated'
              }
            )
      }

      /*
       * SERVICES
       */

      if (
        request.method ===
          'GET' &&
        url.pathname ===
          '/api/services'
      ) {
        const serviceMetrics =
          await Promise.all(
            allowedChaosServices.map(
              (target) =>
                getServiceMetrics(
                  target
                ).catch(
                  (error) => {
                    console.error(
                      `Failed to load metrics for ${target}:`,
                      error
                    )

                    return {
                      target,
                      podName: null,
                      cpuUsage: null,
                      memoryMb: null,
                      podStatus: null,
                      ready: null,
                      restartCount: null
                    }
                  }
                )
            )
          )

        return respond(
          response,
          200,
          {
            services:
              serviceMetrics,
            cluster: null
          }
        )
      }

      /*
       * EXPERIMENT HISTORY
       */

      if (
        request.method ===
          'GET' &&
        url.pathname ===
          '/api/experiments'
      ) {
        await loadExperiments()

        const user =
          await getSessionUser(
            request,
            await loadUsers()
          )

        if (!user) {
          return respond(
            response,
            401,
            {
              error:
                'Authentication is required to view experiment history'
            }
          )
        }

        const legacyErrorRateExperiment =
          experiments.find(
            (experiment) =>
              experiment.userId === user.id &&
              (
                !Object.hasOwn(experiment, 'errorRateMeasurement') ||
                (
                  experiment.errorRateMeasurement?.status ===
                    'unavailable' &&
                  experiment.errorRateMeasurement?.reason ===
                    'This historical experiment predates HTTP counter instrumentation.'
                )
              )
          )

        let scoresAdded = false
        for (const experiment of experiments) {
          if (experiment.userId !== user.id) continue
          let experimentChanged = false

          if (
            !Object.hasOwn(experiment, 'availabilityMeasurement') ||
            (
              experiment.availabilityMeasurement?.status ===
                'unavailable' &&
              experiment.availabilityMeasurement?.reason ===
                'This historical experiment predates timestamped readiness coverage measurements.'
            )
          ) {
            const readinessMeasurement =
              measureAvailability({
                readinessSamples: experiment.readinessSamples,
                windowStart: experiment.startedAt,
                windowEnd: experiment.completedAt,
              })
            experiment.availabilityMeasurement =
              readinessMeasurement
            experimentChanged = true
          }
          if (
            experiment === legacyErrorRateExperiment
          ) {
            experiment.errorRateMeasurement =
              await collectErrorRateMeasurement(experiment)
            experimentChanged = true
          } else if (!Object.hasOwn(experiment, 'errorRateMeasurement')) {
            experiment.errorRateMeasurement = {
              source: 'prometheus-http-counters',
              status: 'unavailable',
              errorRatePercent: null,
              reason:
                'Historical Prometheus counters were not re-queried for this experiment.',
            }
            experimentChanged = true
          }
          const calculatedScore =
            calculateResilienceScore(experiment)
          const scoreChanged =
            Object.entries(calculatedScore).some(
              ([key, value]) =>
                JSON.stringify(experiment[key]) !== JSON.stringify(value)
            )

          if (experimentChanged || scoreChanged) {
            Object.assign(experiment, calculatedScore)
            scoresAdded = true
          }
        }

        if (scoresAdded) {
          await saveExperiments()
        }

        return respond(
          response,
          200,
          {
            experiments:
              experiments.filter(
                (experiment) =>
                  experiment.userId ===
                  user.id
              )
          }
        )
      }

      if (
        request.method === 'DELETE' &&
        url.pathname.startsWith('/api/experiments/')
      ) {
        await loadExperiments()

        const user = await getSessionUser(
          request,
          await loadUsers()
        )

        if (!user) {
          return respond(
            response,
            401,
            {
              error:
                'Authentication is required to delete an experiment report'
            }
          )
        }

        let experimentId
        try {
          experimentId = decodeURIComponent(
            url.pathname.slice('/api/experiments/'.length)
          )
        } catch {
          return respond(
            response,
            400,
            {
              error: 'Experiment ID is invalid'
            }
          )
        }

        const experimentIndex = experiments.findIndex(
          (experiment) =>
            experiment.id === experimentId &&
            experiment.userId === user.id
        )

        if (experimentIndex === -1) {
          return respond(
            response,
            404,
            {
              error: 'Experiment report was not found'
            }
          )
        }

        experiments.splice(experimentIndex, 1)
        await saveExperiments()

        return respond(
          response,
          200,
          {
            success: true,
            id: experimentId
          }
        )
      }

      /*
       * POD FAILURE
       *
       * Real Kubernetes pod deletion.
       * Detection = old pod disappears.
       * Recovery = new pod becomes Ready.
       */

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/api/chaos/pod-failure'
      ) {
        let trafficProbe = null
        try {
          const input =
            await readBody(
              request
            )

          if (!hasValidTrafficProbeOption(input)) {
            return respond(
              response,
              400,
              {
                error:
                  'enableHttpTrafficProbe must be a boolean'
              }
            )
          }

          const target =
            String(
              input.target || ''
            ).trim()

          if (!target) {
            return respond(
              response,
              400,
              {
                error:
                  'target is required'
              }
            )
          }

          if (
            !allowedChaosServices.includes(
              target
            )
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'Invalid chaos target'
              }
            )
          }

          const pods =
            await getPodsForService(
              target
            )

          if (
            pods.length ===
            0
          ) {
            return respond(
              response,
              404,
              {
                error:
                  `No pod found for ${target}`
              }
            )
          }

          const pod =
            pods.find(
              (item) =>
                isPodReady(item)
            ) ||
            pods.find(
              (item) =>
                item.status?.phase === 'Running'
            ) || pods[0]

          const podName =
            pod.metadata?.name

          if (!podName) {
            return respond(
              response,
              500,
              {
                error:
                  'Pod name could not be determined'
              }
            )
          }

          const readyBefore =
            await getPodReadiness(
              target
            )

          if (!readyBefore) {
            return respond(
              response,
              409,
              {
                error:
                  `${target} is not healthy before the experiment`
              }
            )
          }

          const startedAt =
            new Date().toISOString()

          if (input.enableHttpTrafficProbe !== false) {
            trafficProbe =
              startHttpTrafficProbe(target)
          }

          const startTime =
            Date.now()

          const readinessSamples = []
          const expectedReplicaCount =
            pods.length
          const expectedReadyPodCount =
            pods.filter(isPodReady).length
          const restartCountBefore =
            getPodRestartCount(pod)

          await recordReadinessObservation(
            target,
            readinessSamples,
            expectedReplicaCount
          )

          const failureStartedAt =
            Date.now()

          await kubeApi.deleteNamespacedPod(
            {
              name: podName,
              namespace:
                'default',
              gracePeriodSeconds: 0,
            }
          )

          const detection =
            await waitForPodDeletion(
              podName,
              target,
              readinessSamples,
              expectedReplicaCount,
              30000,
              250,
              failureStartedAt,
            )

          const detectedAt =
            new Date().toISOString()

          if (
            !detection.success
          ) {
            const experiment = {
              id: randomUUID(),
              type:
                'pod-failure',
              target,
              podName,
              failedPodUid: pod.metadata?.uid || null,
              failureObservation: {
                ...detection.failureObservation,
                observedAt: detectedAt,
                podUid:
                  detection.failureObservation.podUid ||
                  pod.metadata?.uid ||
                  null,
              },
              replacementCandidatePodName: null,
              replacementCandidatePodUid: null,
              replacementCandidatePodReady: null,
              status:
                'detection-timeout',
              readyBefore,
              readinessSamples,
              restartCountBefore,
              restartCountAfter: null,
              podRestartCount: null,
              startedAt,
              completedAt:
                detectedAt,
              detectedAt,
              detectionTimeMs:
                detection.elapsedMs,
              recoveryTimeMs:
                null,
              totalExperimentTimeMs:
                Date.now() -
                startTime
            }

            await recordExperiment(
              request,
              experiment,
              trafficProbe
            )

            return respond(
              response,
              504,
              {
                message:
                  'Pod failure was injected, but Kubernetes did not confirm deletion of the old pod within 30 seconds',
                experiment
              }
            )
          }

          const detectionTimeMs =
            detection.elapsedMs

          const recovery =
            await waitForReplacementPod(
              target,
              podName,
              readinessSamples,
              expectedReplicaCount,
              expectedReadyPodCount,
              pods.map(
                (initialPod) =>
                  initialPod.metadata?.uid ||
                  initialPod.metadata?.name,
              ),
              60000,
              500
            )

          if (
            !recovery.success
          ) {
            const recoveredAt =
              new Date().toISOString()
            const experiment = {
              id: randomUUID(),
              type:
                'pod-failure',
              target,
              podName,
              failedPodUid: pod.metadata?.uid || null,
              failureObservation: {
                ...detection.failureObservation,
                observedAt: detectedAt,
                podUid:
                  detection.failureObservation.podUid ||
                  pod.metadata?.uid ||
                  null,
              },
              replacementPodName:
                null,
              replacementPodUid:
                null,
              replacementCandidatePodName:
                recovery.candidatePodName,
              replacementCandidatePodUid:
                recovery.candidatePodUid,
              replacementCandidatePodReady:
                recovery.candidatePodReady,
              readinessSamples,
              restartCountBefore,
              restartCountAfter: null,
              podRestartCount: null,
              status:
                'recovery-timeout',
              readyBefore,
              startedAt,
              completedAt:
                recoveredAt,
              detectedAt,
              recoveredAt,
              detectionTimeMs,
              recoveryTimeMs:
                Date.now() - failureStartedAt,
              totalExperimentTimeMs:
                Date.now() -
                startTime
            }

            await recordExperiment(
              request,
              experiment,
              trafficProbe
            )

            return respond(
              response,
              504,
              {
                message:
                  `Failure was detected, but ${target} did not recover within 60 seconds`,
                experiment
              }
            )
          }

          const recoveryTimeMs =
            Date.now() - failureStartedAt

          await recordReadinessObservation(
            target,
            readinessSamples,
            expectedReplicaCount
          )

          const recoveredAt =
            new Date().toISOString()
          const totalExperimentTimeMs =
            Date.now() -
            startTime

          const experiment = {
            id: randomUUID(),
            type:
              'pod-failure',
            target,
            podName,
            failedPodUid: pod.metadata?.uid || null,
            failureObservation: {
              ...detection.failureObservation,
              observedAt: detectedAt,
              podUid:
                detection.failureObservation.podUid ||
                pod.metadata?.uid ||
                null,
            },
            replacementPodName:
              recovery.podName,
            replacementPodUid:
              recovery.podUid,
            replacementCandidatePodName:
              recovery.candidatePodName,
            replacementCandidatePodUid:
              recovery.candidatePodUid,
            replacementCandidatePodReady:
              recovery.candidatePodReady,
            readinessSamples,
            restartCountBefore,
            restartCountAfter:
              recovery.podRestartCount,
            podRestartCount:
              recovery.podRestartCount,
            status:
              'completed',
            readyBefore,
            startedAt,
            completedAt:
              recoveredAt,
            detectedAt,
            recoveredAt,
            detectionTimeMs,
            recoveryTimeMs,
            totalExperimentTimeMs
          }

          await recordExperiment(
            request,
            experiment,
            trafficProbe
          )

          return respond(
            response,
            201,
            {
              message:
                `Pod failure experiment completed successfully for ${target}`,
              experiment
            }
          )
        } catch (error) {
          if (trafficProbe) {
            await trafficProbe.stop()
          }

          console.error(
            'Pod failure experiment failed:',
            error
          )

          return respond(
            response,
            500,
            {
              error:
                'Failed to execute pod failure experiment',
              details:
                error.message
            }
          )
        }
      }

      /*
       * CPU STRESS
       *
       * Real CPU-intensive workload
       * executed inside the target pod.
       *
       * Prometheus measures:
       * - baseline CPU
       * - peak CPU
       * - post-stress CPU
       * - CPU increase
       */

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/api/chaos/cpu-stress'
      ) {
        let stopReadinessSampling
        let trafficProbe = null
        try {
          const input =
            await readBody(
              request
            )

          if (!hasValidTrafficProbeOption(input)) {
            return respond(
              response,
              400,
              {
                error:
                  'enableHttpTrafficProbe must be a boolean'
              }
            )
          }

          const target =
            String(
              input.target || ''
            ).trim()

          const durationMs =
            Math.min(
              Math.max(
                Number(
                  input.durationMs ||
                    15000
                ),
                5000
              ),
              30000
            )

          if (!target) {
            return respond(
              response,
              400,
              {
                error:
                  'target is required'
              }
            )
          }

          if (
            !allowedChaosServices.includes(
              target
            )
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'Invalid chaos target'
              }
            )
          }

          const readyBefore =
            await getPodReadiness(
              target
            )

          if (!readyBefore) {
            return respond(
              response,
              409,
              {
                error:
                  `${target} is not healthy before the experiment`
              }
            )
          }

          const podName =
            await getCurrentPodName(
              target
            )

          if (!podName) {
            return respond(
              response,
              404,
              {
                error:
                  `No running pod found for ${target}`
              }
            )
          }

          const initialPods =
            await getPodsForService(
              target
            )
          const initialPod =
            initialPods.find(
              (pod) =>
                pod.metadata?.name ===
                podName
            )
          const restartCountBefore =
            getPodRestartCount(
              initialPod
            )
          const readinessSamples = []

          await recordReadinessObservation(
            target,
            readinessSamples,
            initialPods.length
          )

          const baselineCpu =
            await getPodCpuUsageByPod(
              podName
            )

          if (
            baselineCpu ===
              null ||
            Number.isNaN(
              baselineCpu
            )
          ) {
            return respond(
              response,
              503,
              {
                error:
                  'Prometheus CPU metric is not available for the target pod'
              }
            )
          }

          const startedAt =
            new Date().toISOString()

          const startTime =
            Date.now()

          stopReadinessSampling =
            startReadinessSampling(
              target,
              readinessSamples,
              initialPods.length
            )

          if (input.enableHttpTrafficProbe !== false) {
            trafficProbe =
              startHttpTrafficProbe(target)
          }

          /*
           * Start the real workload.
           */

          const stressPromise =
            runCpuStress(
              target,
              podName,
              durationMs
            )

          let peakCpu =
            baselineCpu

          const samples = []

          /*
           * Sample real Prometheus CPU
           * usage while the workload runs.
           *
           * Prometheus may return the same
           * value for several samples because
           * its scrape interval is independent
           * of our 1-second polling interval.
           */

          const sampleUntil =
            Date.now() +
            durationMs

          while (
            Date.now() <
            sampleUntil
          ) {
            await sleep(
              1000
            )

            const cpu =
              await getPodCpuUsageByPod(
                podName
              )

            if (
              cpu !== null &&
              !Number.isNaN(cpu)
            ) {
              samples.push({
                cpu,
                recordedAt:
                  new Date().toISOString()
              })

              if (
                cpu >
                peakCpu
              ) {
                peakCpu =
                  cpu
              }
            }
          }

          /*
           * Wait for the actual stress
           * command to finish.
           */

          await stressPromise

          /*
           * Give Prometheus time to publish
           * the latest CPU observation.
           */

          await sleep(
            2000
          )

          const postStressCpu =
            await getPodCpuUsageByPod(
              podName
            )

          await stopReadinessSampling()
          stopReadinessSampling = null

          const finalPods =
            await getPodsForService(
              target
            )
          const finalPod =
            finalPods.find(
              (pod) =>
                pod.metadata?.name ===
                podName
            )
          const restartCountAfter =
            getPodRestartCount(
              finalPod
            )

          /*
           * Include the post-stress
           * measurement in the peak if
           * it is higher than the sampled
           * values.
           */

          if (
            postStressCpu !== null &&
            !Number.isNaN(
              postStressCpu
            ) &&
            postStressCpu >
              peakCpu
          ) {
            peakCpu =
              postStressCpu
          }

          const cpuIncrease =
            peakCpu -
            baselineCpu

          const totalExperimentTimeMs =
            Date.now() -
            startTime

          const experiment = {
            id: randomUUID(),
            type:
              'cpu-stress',
            target,
            podName,
            status:
              'completed',
            readyBefore,
            readinessSamples,
            restartCountBefore,
            restartCountAfter,
            stressDurationMs:
              durationMs,
            baselineCpu,
            peakCpu,
            postStressCpu,
            cpuIncrease,
            cpuSamples:
              samples,
            startedAt,
            completedAt:
              new Date().toISOString(),
            totalExperimentTimeMs
          }

          await recordExperiment(
            request,
            experiment,
            trafficProbe
          )

          return respond(
            response,
            201,
            {
              message:
                `CPU stress experiment completed successfully for ${target}`,
              experiment
            }
          )
        } catch (error) {
          if (stopReadinessSampling) {
            await stopReadinessSampling()
          }
          if (trafficProbe) {
            await trafficProbe.stop()
          }
          console.error(
            'CPU stress experiment failed:',
            error
          )

          return respond(
            response,
            500,
            {
              error:
                'Failed to execute CPU stress experiment',
              details:
                error.message
            }
          )
        }
      }

      /*
 * MEMORY STRESS
 *
 * Real memory allocation inside the
 * target Kubernetes pod.
 *
 * Prometheus measures:
 * - baseline memory
 * - peak memory
 * - post-stress memory
 * - memory increase
 */

if (
  request.method ===
    'POST' &&
  url.pathname ===
    '/api/chaos/memory-stress'
) {
  let stopReadinessSampling
  let trafficProbe = null
  try {
    const input =
      await readBody(
        request
      )

    if (!hasValidTrafficProbeOption(input)) {
      return respond(
        response,
        400,
        {
          error:
            'enableHttpTrafficProbe must be a boolean'
        }
      )
    }

    const target =
      String(
        input.target || ''
      ).trim()

    const durationMs =
      Math.min(
        Math.max(
          Number(
            input.durationMs ||
              15000
          ),
          5000
        ),
        30000
      )

    const memoryMb =
      Math.min(
        Math.max(
          Number(
            input.memoryMb ||
              256
          ),
          64
        ),
        512
      )

    if (!target) {
      return respond(
        response,
        400,
        {
          error:
            'target is required'
        }
      )
    }

    if (
      !allowedChaosServices.includes(
        target
      )
    ) {
      return respond(
        response,
        400,
        {
          error:
            'Invalid chaos target'
        }
      )
    }

    const readyBefore =
      await getPodReadiness(
        target
      )

    if (!readyBefore) {
      return respond(
        response,
        409,
        {
          error:
            `${target} is not healthy before the experiment`
        }
      )
    }

    const podName =
      await getCurrentPodName(
        target
      )

    if (!podName) {
      return respond(
        response,
        404,
        {
          error:
            `No running pod found for ${target}`
        }
      )
    }

    const initialPods =
      await getPodsForService(
        target
      )
    const initialPod =
      initialPods.find(
        (pod) =>
          pod.metadata?.name ===
          podName
      )
    const restartCountBefore =
      getPodRestartCount(
        initialPod
      )
    const readinessSamples = []

    await recordReadinessObservation(
      target,
      readinessSamples,
      initialPods.length
    )

    const containerName =
      await getTargetContainerName(
        target,
        podName
      )

    if (!containerName) {
      return respond(
        response,
        404,
        {
          error:
            `No target container found for ${target}`
        }
      )
    }

    const baselineMemoryBytes =
      await getPodMemoryUsageByPod(
        podName,
        containerName
      )

    if (
      baselineMemoryBytes ===
        null ||
      Number.isNaN(
        baselineMemoryBytes
      )
    ) {
      return respond(
        response,
        503,
        {
          error:
            'Prometheus memory metric is not available for the target pod'
        }
      )
    }

    const startedAt =
      new Date().toISOString()

    const startTime =
      Date.now()

    stopReadinessSampling =
      startReadinessSampling(
        target,
        readinessSamples,
        initialPods.length
      )

    if (input.enableHttpTrafficProbe !== false) {
      trafficProbe =
        startHttpTrafficProbe(target)
    }

    const stressPromise =
      runMemoryStress(
        target,
        podName,
        durationMs,
        memoryMb
      )

    let peakMemoryBytes =
      baselineMemoryBytes

    const samples = []

    let stressCompleted =
      false

    stressPromise.then(
      () => {
        stressCompleted =
          true
      },
      () => {
        stressCompleted =
          true
      }
    )

    while (!stressCompleted) {
      const memoryBytes =
        await getPodMemoryUsageByPod(
          podName,
          containerName
        )

      if (
        memoryBytes !== null &&
        !Number.isNaN(
          memoryBytes
        )
      ) {
        samples.push({
          memoryBytes,
          memoryMb:
            memoryBytes /
            (1024 * 1024),
          recordedAt:
            new Date().toISOString()
        })

        if (
          memoryBytes >
          peakMemoryBytes
        ) {
          peakMemoryBytes =
            memoryBytes
        }
      }

      if (!stressCompleted) {
        await sleep(
          1000
        )
      }
    }

    await stressPromise

    await sleep(
      2000
    )

    const postStressMemoryBytes =
      await getPodMemoryUsageByPod(
        podName,
        containerName
      )

    await stopReadinessSampling()
    stopReadinessSampling = null

    const finalPods =
      await getPodsForService(
        target
      )
    const finalPod =
      finalPods.find(
        (pod) =>
          pod.metadata?.name ===
          podName
      )
    const restartCountAfter =
      getPodRestartCount(
        finalPod
      )

    if (
      postStressMemoryBytes !==
        null &&
      !Number.isNaN(
        postStressMemoryBytes
      ) &&
      postStressMemoryBytes >
        peakMemoryBytes
    ) {
      peakMemoryBytes =
        postStressMemoryBytes
    }

    const memoryIncreaseBytes =
      peakMemoryBytes -
      baselineMemoryBytes

    const totalExperimentTimeMs =
      Date.now() -
      startTime

    const experiment = {
      id:
        randomUUID(),

      type:
        'memory-stress',

      target,

      podName,

      status:
        'completed',

      readyBefore,
      readinessSamples,
      restartCountBefore,
      restartCountAfter,

      stressDurationMs:
        durationMs,

      requestedMemoryMb:
        memoryMb,

      baselineMemoryBytes,

      baselineMemoryMb:
        baselineMemoryBytes /
        (1024 * 1024),

      peakMemoryBytes,

      peakMemoryMb:
        peakMemoryBytes /
        (1024 * 1024),

      postStressMemoryBytes,

      postStressMemoryMb:
        postStressMemoryBytes ===
        null
          ? null
          : postStressMemoryBytes /
            (1024 * 1024),

      memoryIncreaseBytes,

      memoryIncreaseMb:
        memoryIncreaseBytes /
        (1024 * 1024),

      memorySamples:
        samples,

      startedAt,

      completedAt:
        new Date().toISOString(),

      totalExperimentTimeMs
    }

    await recordExperiment(
      request,
      experiment,
      trafficProbe
    )

    return respond(
      response,
      201,
      {
        message:
          `Memory stress experiment completed successfully for ${target}`,

        experiment
      }
    )
  } catch (error) {
    if (stopReadinessSampling) {
      await stopReadinessSampling()
    }
    if (trafficProbe) {
      await trafficProbe.stop()
    }
    console.error(
      'Memory stress experiment failed:',
      error
    )

    return respond(
      response,
      500,
      {
        error:
          'Failed to execute memory stress experiment',

        details:
          error.message
      }
    )
  }
}
      /*
       * GENERIC EXPERIMENT CREATION
       */

      if (
        request.method ===
          'POST' &&
        url.pathname ===
          '/api/experiments'
      ) {
        try {
          const input =
            await readBody(
              request
            )

          if (
            !input.target ||
            !input.experiment
          ) {
            return respond(
              response,
              400,
              {
                error:
                  'target and experiment are required'
              }
            )
          }

          const experiment = {
            id: randomUUID(),
            ...input,
            status:
              'running',
            startedAt:
              new Date().toISOString()
          }

          await recordExperiment(
            request,
            experiment
          )

          return respond(
            response,
            201,
            {
              experiment
            }
          )
        } catch {
          return respond(
            response,
            400,
            {
              error:
                'Request body must be valid JSON'
            }
          )
        }
      }

      /*
       * NOT FOUND
       */

      return respond(
        response,
        404,
        {
          error:
            'Not found'
        }
      )
    }
  )

/*
 * PORT ERROR HANDLING
 */

server.on(
  'error',
  (error) => {
    if (
      error.code !==
      'EADDRINUSE'
    ) {
      console.error(error)
      process.exitCode = 1
      return
    }

    fetch(
      `http://127.0.0.1:${port}/api/health`,
      {
        signal:
          AbortSignal.timeout(
            1500
          )
      }
    )
      .then(
        async (
          response
        ) => {
          const body =
            response.ok
              ? await response.json()
              : null

          if (
            body?.status ===
            'operational'
          ) {
            console.log(
              `ChaosGuard API is already running on http://localhost:${port}`
            )
            return
          }

          console.error(
            `Port ${port} is already in use by another service.`
          )

          process.exitCode = 1
        }
      )
      .catch(() => {
        console.error(
          `Port ${port} is already in use, but no ChaosGuard API responded there.`
        )

        process.exitCode = 1
      })
  }
)

/*
 * START SERVER
 */

restoreSessions()
  .then(
    () => {
      server.listen(
        port,
        '0.0.0.0',
        () => {
          console.log(
            `ChaosGuard API listening on http://localhost:${port}`
          )
        }
      )
    }
  )
  .catch(
    (error) => {
      console.error(
        'Unable to restore authentication sessions:',
        error
      )
      process.exitCode = 1
    }
  )
