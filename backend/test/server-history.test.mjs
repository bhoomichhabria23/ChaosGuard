import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url))

async function getAvailablePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return port
}

test('GET /api/experiments returns and persists scores for completed history', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'chaosguard-score-test-'))
  const port = await getAvailablePort()
  let serverProcess = spawn(process.execPath, [serverPath], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: '',
      RENDER_SERVICE_ID: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverOutput = ''
  serverProcess.stdout.setEncoding('utf8').on('data', (chunk) => {
    serverOutput += chunk
  })
  serverProcess.stderr.setEncoding('utf8').on('data', (chunk) => {
    serverOutput += chunk
  })

  t.after(async () => {
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill()
      await once(serverProcess, 'exit')
    }
    await rm(workspace, { recursive: true, force: true })
  })

  const baseUrl = `http://127.0.0.1:${port}`
  let healthy = false
  let healthError
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Backend exited before startup:\n${serverOutput}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) {
        healthy = true
        break
      }
    } catch {
      healthError = 'Connection not ready yet.'
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  assert.equal(
    healthy,
    true,
    `Backend did not start (${healthError || 'unknown error'}):\n${serverOutput}`,
  )

  const credentials = {
    name: 'Score Test',
    email: 'score-test@example.invalid',
    password: 'score-test-password',
  }
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const { user } = await registration.json()
  assert.equal(registration.status, 201)

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)

  const dataDirectory = join(workspace, 'data')
  await mkdir(dataDirectory, { recursive: true })
  await writeFile(
    join(dataDirectory, 'experiments.json'),
    JSON.stringify([
      {
        id: 'persisted-score-test',
        userId: user.id,
        type: 'pod-failure',
        target: 'user-service',
        status: 'completed',
        startedAt: '2026-10-09T10:00:00.000Z',
        completedAt: '2026-10-09T10:00:03.000Z',
        detectionTimeMs: 800,
        recoveryTimeMs: 1500,
        errorRateMeasurement: {
          status: 'no-traffic',
          errorRatePercent: null,
          reason: 'No HTTP requests were observed during the experiment window.',
        },
        scoreBreakdown: {
          recovery: 90,
          detection: 100,
          availability: 0,
          stability: 100,
          errorRate: null,
        },
        resilienceScore: 68.3,
        readinessSamples: [
          {
            readyPods: 1,
            totalPods: 1,
            recordedAt: '2026-10-09T10:00:00.000Z',
          },
          {
            readyPods: 0,
            totalPods: 1,
            recordedAt: '2026-10-09T10:00:01.500Z',
          },
          {
            readyPods: 1,
            totalPods: 1,
            recordedAt: '2026-10-09T10:00:03.000Z',
          },
        ],
        podRestartCount: 0,
      },
    ]),
    'utf8',
  )

  const historyResponse = await fetch(`${baseUrl}/api/experiments`, {
    headers: { Cookie: cookie },
  })
  assert.equal(historyResponse.status, 200)
  const history = await historyResponse.json()
  const experiment = history.experiments.find(
    (item) => item.id === 'persisted-score-test',
  )
  assert.equal(experiment.resilienceScore, 81.2)
  assert.equal(experiment.scoreBreakdown.recovery, 90)
  assert.equal(experiment.scoreBreakdown.detection, 100)
  assert.equal(experiment.scoreBreakdown.availability, 50)
  assert.equal(experiment.scoreBreakdown.stability, null)
  assert.equal(Object.hasOwn(experiment.scoreBreakdown, 'errorRate'), false)
  assert.equal(experiment.availableWeightPercent, 85)
  assert.deepEqual(experiment.scoreWeights, {
    recovery: 35,
    detection: 25,
    availability: 25,
    stability: 15,
  })
  assert.deepEqual(experiment.effectiveScoreWeights, {
    recovery: 41.18,
    detection: 29.41,
    availability: 29.41,
  })
  assert.equal(experiment.availabilityMeasurement.status, 'measured')
  assert.equal(experiment.availabilityMeasurement.availabilityPercent, 50)
  assert.equal(experiment.errorRateMeasurement.status, 'no-traffic')

  const persisted = JSON.parse(
    await readFile(join(dataDirectory, 'experiments.json'), 'utf8'),
  )
  assert.equal(persisted[0].resilienceScore, 81.2)
  assert.equal(persisted[0].scoreBreakdown.availability, 50)

  const unauthenticatedDelete = await fetch(
    `${baseUrl}/api/experiments/persisted-score-test`,
    { method: 'DELETE' },
  )
  assert.equal(unauthenticatedDelete.status, 401)

  const missingDelete = await fetch(
    `${baseUrl}/api/experiments/unknown-experiment`,
    {
      method: 'DELETE',
      headers: { Cookie: cookie },
    },
  )
  assert.equal(missingDelete.status, 404)

  serverProcess.kill()
  await once(serverProcess, 'exit')
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: '',
      RENDER_SERVICE_ID: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess.stdout.setEncoding('utf8').on('data', (chunk) => {
    serverOutput += chunk
  })
  serverProcess.stderr.setEncoding('utf8').on('data', (chunk) => {
    serverOutput += chunk
  })

  let restartedHealthy = false
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Backend exited after restart:\n${serverOutput}`)
    }
    try {
      const healthResponse = await fetch(`${baseUrl}/api/health`)
      if (healthResponse.ok) {
        restartedHealthy = true
        break
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  assert.equal(
    restartedHealthy,
    true,
    `Backend did not restart:\n${serverOutput}`,
  )

  const restoredSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie },
  })
  assert.equal(restoredSession.status, 200)
  assert.equal((await restoredSession.json()).user.id, user.id)

  const deleteResponse = await fetch(
    `${baseUrl}/api/experiments/persisted-score-test`,
    {
      method: 'DELETE',
      headers: { Cookie: cookie },
    },
  )
  assert.equal(deleteResponse.status, 200)
  assert.deepEqual(await deleteResponse.json(), {
    success: true,
    id: 'persisted-score-test',
  })

  const historyAfterDelete = await fetch(`${baseUrl}/api/experiments`, {
    headers: { Cookie: cookie },
  })
  assert.deepEqual((await historyAfterDelete.json()).experiments, [])
  assert.deepEqual(
    JSON.parse(await readFile(join(dataDirectory, 'experiments.json'), 'utf8')),
    [],
  )
})
