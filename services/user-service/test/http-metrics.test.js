import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import test from 'node:test'
import { createHttpMetrics } from '../../shared/http-metrics.js'

test('HTTP metrics expose bounded counters and count 4xx/5xx responses', async (t) => {
  const app = express()
  const metrics = createHttpMetrics('user-service')
  app.use(metrics.middleware)
  app.get('/metrics', metrics.metricsHandler)
  app.get('/health', (_request, response) => response.sendStatus(200))
  app.get('/ok', (_request, response) => response.sendStatus(200))
  app.get('/client-error', (_request, response) => response.sendStatus(404))
  app.get('/server-error', (_request, response) => response.sendStatus(500))

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  }))

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  for (const path of ['/ok', '/client-error', '/server-error', '/health']) {
    await fetch(`${baseUrl}${path}`)
  }
  const metricsResponse = await fetch(`${baseUrl}/metrics`)
  const metricsText = await metricsResponse.text()

  assert.equal(metricsResponse.status, 200)
  assert.match(metricsText, /chaosguard_http_requests_total\{service="user-service"\} 3/)
  assert.match(metricsText, /chaosguard_http_server_errors_total\{service="user-service"\} 1/)
  assert.match(metricsText, /chaosguard_http_client_errors_total\{service="user-service"\} 1/)
  assert.match(metricsText, /status_class="2xx"\} 1/)
  assert.match(metricsText, /status_class="4xx"\} 1/)
  assert.match(metricsText, /status_class="5xx"\} 1/)
  assert.doesNotMatch(metricsText, /\/metrics/)
})
