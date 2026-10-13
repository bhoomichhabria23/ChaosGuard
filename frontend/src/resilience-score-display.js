export function getScoreDisplayPercent(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.min(99, Math.max(1, Number(value.toFixed(2))))
}

export function formatResilienceScore(value) {
  const displayPercent = getScoreDisplayPercent(value)
  return displayPercent === null ? '—' : `${displayPercent.toFixed(2)}%`
}

export function formatComponentScore(value) {
  return formatResilienceScore(value)
}

export function formatAvailabilityEvidence(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return 'Pending'
  }
  if (value === 0) return 'No health checks succeeded'
  if (value === 100) return 'All health checks succeeded'
  const roundedValue = Number(value.toFixed(2))
  if (roundedValue === 0) return 'Very few health checks succeeded'
  if (roundedValue === 100) return 'Nearly all health checks succeeded'
  return `${roundedValue}% healthy checks`
}

export function formatSuccessfulRequestEvidence(successful, total) {
  if (
    !Number.isFinite(successful) ||
    !Number.isFinite(total) ||
    successful < 0 ||
    total <= 0 ||
    successful > total
  ) {
    return 'Pending'
  }
  if (successful === 0) {
    return `No requests succeeded (${total} observed)`
  }
  return `${successful} of ${total} requests succeeded`
}
