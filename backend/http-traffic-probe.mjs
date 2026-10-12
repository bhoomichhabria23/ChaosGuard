const statusClasses = ['1xx', '2xx', '3xx', '4xx', '5xx']

export function createHttpTrafficProbe(
  request,
  { intervalMs = 1000 } = {},
) {
  if (typeof request !== 'function') {
    throw new TypeError('Traffic probe request must be a function')
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new RangeError('Traffic probe interval must be a positive integer')
  }

  let stopped = false
  let timer = null
  let attempts = 0
  let completedResponses = 0
  let deliveryFailures = 0
  let inFlight = Promise.resolve()
  const statusClassCounts = Object.fromEntries(
    statusClasses.map((statusClass) => [statusClass, 0]),
  )

  const sendRequest = async () => {
    attempts += 1
    try {
      const statusCode = await request()
      if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
        throw new Error('Traffic probe received an invalid HTTP status')
      }
      completedResponses += 1
      statusClassCounts[`${Math.floor(statusCode / 100)}xx`] += 1
    } catch (error) {
      deliveryFailures += 1
      console.error('Opt-in HTTP traffic probe request failed:', error)
    }

    if (!stopped) {
      timer = setTimeout(() => {
        inFlight = sendRequest()
      }, intervalMs)
    }
  }

  inFlight = sendRequest()

  return {
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await inFlight
      return {
        enabled: true,
        intervalMs,
        attempts,
        completedResponses,
        deliveryFailures,
        statusClassCounts,
      }
    },
  }
}
