const statusClasses = ['1xx', '2xx', '3xx', '4xx', '5xx', 'other']

export function createHttpMetrics(service) {
  let requests = 0
  let serverErrors = 0
  let clientErrors = 0
  const responsesByStatusClass = new Map(
    statusClasses.map((statusClass) => [statusClass, 0]),
  )

  function middleware(request, response, next) {
    const isInternalProbe =
      request.path === '/metrics' || request.path === '/health'
    if (!isInternalProbe) requests += 1

    if (!isInternalProbe) {
      response.once('finish', () => {
        const statusCode = response.statusCode
        const statusClass =
          statusCode >= 100 && statusCode < 600
            ? `${Math.floor(statusCode / 100)}xx`
            : 'other'
        responsesByStatusClass.set(
          statusClass,
          (responsesByStatusClass.get(statusClass) || 0) + 1,
        )
        if (statusCode >= 500) serverErrors += 1
        else if (statusCode >= 400) clientErrors += 1
      })
    }

    next()
  }

  function render() {
    const lines = [
      '# HELP chaosguard_http_requests_total HTTP requests received by the service process.',
      '# TYPE chaosguard_http_requests_total counter',
      `chaosguard_http_requests_total{service="${service}"} ${requests}`,
      '# HELP chaosguard_http_server_errors_total HTTP responses with a 5xx status.',
      '# TYPE chaosguard_http_server_errors_total counter',
      `chaosguard_http_server_errors_total{service="${service}"} ${serverErrors}`,
      '# HELP chaosguard_http_client_errors_total HTTP responses with a 4xx status.',
      '# TYPE chaosguard_http_client_errors_total counter',
      `chaosguard_http_client_errors_total{service="${service}"} ${clientErrors}`,
      '# HELP chaosguard_http_responses_total Completed HTTP responses by status class.',
      '# TYPE chaosguard_http_responses_total counter',
    ]

    for (const [statusClass, count] of responsesByStatusClass) {
      lines.push(
        `chaosguard_http_responses_total{service="${service}",status_class="${statusClass}"} ${count}`,
      )
    }

    return `${lines.join('\n')}\n`
  }

  function metricsHandler(_request, response) {
    response.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    response.send(render())
  }

  return { middleware, metricsHandler }
}
