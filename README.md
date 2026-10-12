# ChaosGuard

ChaosGuard is a React-based cloud resilience console backed by a native Node.js HTTP API. Pod failure, CPU stress, and memory stress experiments use Kubernetes and Prometheus observations.

## Run locally

Start the backend and frontend in separate PowerShell terminals.

```powershell
Set-Location C:\Users\ektac\ChaosGuard\backend
npm run dev
```

In a second terminal:

```powershell
Set-Location C:\Users\ektac\ChaosGuard\frontend
npm run dev
```

The backend prints `ChaosGuard API listening on http://localhost:4174` in its terminal. The frontend terminal prints the Vite URL; Vite proxies `/api` requests to the backend on port `4174` and does not start or log the backend.

## API

- `GET /api/health` reports API status.
- `GET /api/services` returns the monitored mock services.
- `GET /api/experiments` returns the authenticated user's persisted experiment history, including backend-calculated resilience scores.
- `POST /api/experiments` accepts a target, experiment name, duration, intensity, and pod count.

## Resilience score

The backend calculates a 0–100 score from valid measured metrics only. Available metric weights are normalized to 100%; at least two metrics must be available or `resilienceScore` is `null`. Missing metric scores are `null`, appear as `N/A` in the UI, and include a reason in `missingMetricReasons`.

| Metric | Weight | Deterministic score thresholds |
| --- | ---: | --- |
| Recovery time | 35% | ≤1s: 100; >1–3s: 90; >3–5s: 80; >5–10s: 60; >10–20s: 40; >20s: 20 |
| Detection time | 25% | ≤1s: 100; >1–3s: 90; >3–5s: 80; >5–10s: 60; >10–20s: 40; >20s: 20 |
| Availability/readiness | 25% | For Pod Failure, score is measured availability × monitoring coverage / 100. The raw availability and coverage remain separately visible; this conservative score does not claim unobserved time was healthy. Other experiment types score the measured availability percentage directly. |
| Pod stability | 15% | For Pod Failure, count the confirmed failed-target event once, then add observed restart-count increases across comparable non-target pod identities: 0 disruptions: 100; 1: 70; 2–3: 40; >3: 0. A replacement is evidence of the confirmed failure lifecycle, not a container restart; it is shown separately and is not double-counted. Restart deltas are only calculated for the same pod identity. Other experiment types retain the restart-count scale. |

Detection and recovery measurements are stored in milliseconds and compared with the thresholds above. Configure each threshold list independently with `CHAOSGUARD_RECOVERY_SCORE_THRESHOLDS` or `CHAOSGUARD_DETECTION_SCORE_THRESHOLDS`, using JSON entries with a numeric `maxMs` and `score` and a final `maxMs: null` catch-all. Limits must increase and scores must be non-increasing from 0 to 100. For example, `[{ "maxMs": 1000, "score": 100 }, { "maxMs": 5000, "score": 70 }, { "maxMs": null, "score": 20 }]`. Invalid configuration stops backend startup rather than silently applying another scale. An observed timeout is scored from its actual elapsed duration; a missing duration is unavailable, not zero. Legacy pod-failure reports can derive timings only from recorded healthy-to-unhealthy and unhealthy-to-healthy readiness transitions. New Pod Failure recovery time spans the deletion request through restoration of the pre-injection ready-pod capacity. Replacement pods must be new pod identities; an already-running survivor is not mistaken for the replacement.

Availability is measured from timestamped Kubernetes API pod-readiness observations between the experiment's `startedAt` and `completedAt`. Samples outside that exact window, invalid windows, zero-pod samples, and conflicting duplicate timestamps are not used. Each observation counts the selected service's ready pods using its `app=<service>` selector. The service is considered available when at least one matching pod is Kubernetes Ready (which is gated by the `/health` HTTP readiness probe); multiple replicas are treated as redundant service endpoints, not averaged as separate percentage points. Each state is held forward only until the next observation or 2 seconds, whichever comes first. Longer gaps are unobserved, not treated as healthy or unhealthy. At least two valid observations and 80% valid-duration coverage are required. The reported percentage is healthy observed duration divided by valid observed duration; the window, healthy/valid durations, sample counts, and coverage are persisted.

For Pod Failure, stability includes the confirmed Kubernetes failure observation (selected pod absent, deleting, terminal, or not Ready), the selected pod UID, and the replacement pod name/UID when a new ready replacement is observed. The confirmed target failure contributes one observed pod disruption even when the replacement starts with zero container restarts. Additional disruptions come only from restart-count increases for the same surviving/replacement pod identities, excluding the deliberately deleted target; pod names/UIDs are not compared as restart counters. If restart samples are absent, the confirmed failure can still be scored as one disruption and restart evidence remains unavailable. Availability scoring multiplies the measured healthy fraction of valid observed time by monitoring coverage, yielding a conservative lower bound for the full experiment window; raw healthy/observed duration and coverage are displayed so unobserved time is not misrepresented as a measured outage. Scores are not clamped to avoid genuine extremes.

Existing history is recalculated from timestamps and readiness observations already stored in each experiment; it is never filled with estimated readiness. For the latest legacy experiment, the backend also retries the exact Prometheus window once if a prior history load marked its HTTP measurement as predating instrumentation. If its source samples were not retained or were never collected, the metric remains unavailable.

All four service processes expose `/metrics`. `chaosguard_http_requests_total` counts application requests received; `/metrics` scrapes and Kubernetes `/health` readiness probes are excluded. `chaosguard_http_server_errors_total` counts completed HTTP 5xx responses. `chaosguard_http_client_errors_total` reports 4xx separately. Counters have only bounded `service` and status-class labels. PromQL `increase()` handles counter resets. Error rate is 5xx increases divided by request increases over the exact experiment window; it is retained as real Prometheus telemetry but is not an additional weighted metric. The ServiceMonitor scrapes every second; coverage uses a 2-second freshness window to allow one missed scrape. At least two counter samples and 80% scrape coverage are required. If no application requests occurred, the value is unavailable and the UI says “No traffic observed,” not 0%. Missing or stale monitoring data is unavailable, never treated as a passing score.

Each experiment generates measured application traffic by default. **Generate measured traffic** is enabled by default and sends at most one GET per second through the Kubernetes Service proxy to that service's existing read-only API route (`/api/users`, `/api/orders`, `/api/payments`, or `/api/notifications`). It may be explicitly disabled in the experiment configuration. The recorded probe summary is informational; Prometheus HTTP counters remain the source for request error-rate telemetry and are not substituted for missing readiness observations. Probe traffic is part of the service's actual request volume, alongside any other real application traffic. If the probe cannot reach the service, or Prometheus lacks enough samples/coverage for that experiment window, the error rate remains unavailable rather than being inferred from the probe's delivery failures.

Unavailable metrics are excluded and the backend reports the available configured weight plus normalized effective weights. CPU and memory samples are recorded from Prometheus but do not substitute for a weighted score metric. CPU and memory stress do not measure detection or recovery time.

### Deploy HTTP metrics and readiness

The manifests assume the installed kube-prometheus-stack release is named `monitoring` in namespace `default` (as selected by `release: monitoring`). From the repository root in PowerShell, rebuild only the four service images using the repository-root build context, then apply the four service manifests and ServiceMonitor:

```powershell
docker build -f services/user-service/Dockerfile -t chaosguard/user-service:1.0 .
docker build -f services/order-service/Dockerfile -t chaosguard/order-service:1.0 .
docker build -f services/payment-service/Dockerfile -t chaosguard/payment-service:1.0 .
docker build -f services/notification-service/Dockerfile -t chaosguard/notification-service:1.0 .

kubectl apply -f kubernetes/user-service.yaml
kubectl apply -f kubernetes/order-service.yaml
kubectl apply -f kubernetes/payment-service.yaml
kubectl apply -f kubernetes/notification-service.yaml
kubectl apply -f kubernetes/chaosguard-servicemonitor.yaml

kubectl rollout status deployment/user-service -n default
kubectl rollout status deployment/order-service -n default
kubectl rollout status deployment/payment-service -n default
kubectl rollout status deployment/notification-service -n default
```

In a separate PowerShell terminal, forward Prometheus to the backend's default URL:

```powershell
kubectl port-forward service/monitoring-kube-prometheus-prometheus 9090:9090 -n default
```

Verify the ServiceMonitor target states and request counter in another terminal:

```powershell
$targets = (Invoke-RestMethod 'http://localhost:9090/api/v1/targets?state=active').data.activeTargets
$targets | Where-Object { $_.labels.job -in @('user-service', 'order-service', 'payment-service', 'notification-service') } | Select-Object @{Name='service';Expression={$_.labels.job}}, health, lastError

Invoke-RestMethod -Uri 'http://localhost:9090/api/v1/query' -Method Get -Body @{ query = 'chaosguard_http_requests_total' } |
  ConvertTo-Json -Depth 8
```

For HTTP traffic tests from Windows, forward a service port in a separate terminal, for example `kubectl port-forward service/user-service 13001:3001 -n default`, then request `http://localhost:13001/api/users`. The project has no production route designed to return 5xx; the instrumentation test uses a temporary test-only HTTP handler to verify 5xx counting without adding a fake production endpoint.

Backend tests run with:

```powershell
Set-Location C:\Users\ektac\ChaosGuard\backend
npm test
```

HTTP instrumentation tests run with:

```powershell
Set-Location C:\Users\ektac\ChaosGuard\services\user-service
npm test
```