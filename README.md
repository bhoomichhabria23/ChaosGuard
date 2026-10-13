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

## Deploy the frontend and API separately

Set `VITE_API_BASE_URL` in the frontend hosting service to the backend's public base URL (for example, `https://your-api.example.com`) and rebuild the frontend. The backend allows `https://chaosguard-frontend.onrender.com` by default. Set `FRONTEND_ORIGIN` to add one or more additional exact frontend origins (comma-separated, with no paths) if needed. The API uses allowed origins for credentialed CORS requests and secure cross-site session cookies. Keep `FRONTEND_ORIGIN` unset for local same-origin/Vite-proxy development.

Configure `MONGODB_URI` in `backend/.env` for local development and in the backend hosting service's secret environment settings for production; optionally set `MONGODB_DB_NAME` (defaults to `chaosguard`). In Atlas, allow the backend host's outbound IP addresses under Network Access and use a database user limited to the required database. The backend stores registered users, sessions, and per-user resilience reports in MongoDB. Production startup fails if the MongoDB URI is missing or the database cannot be reached; JSON-file persistence is used only for local development and tests. Never commit `.env`.

## API

- `GET /api/health` reports API status.
- `GET /api/services` returns the monitored mock services.
- `GET /api/experiments` returns the authenticated user's persisted experiment history, including backend-calculated resilience scores.
- `POST /api/experiments` accepts a target, experiment name, duration, intensity, and pod count.

## Resilience score

All three experiment types use the same five measured components, each worth 20%:

| Component | Calculation | Measurement |
| --- | --- | --- |
| Availability | successful health observations / total valid health observations × 100 | Kubernetes Ready pod observations over the measured window |
| Performance | min(100, (measured baseline × (1 + allowed degradation / 100)) / actual average response time × 100) | Actual HTTP probe response times and the pre-injection baseline |
| Error handling | successful requests / total requests × 100 | Prometheus request counters; 4xx and 5xx responses are unsuccessful |
| Detection | min(100, detection-time target / actual detection time × 100) | Actual monitoring observation of the experiment's defined unhealthy condition |
| Recovery | min(100, recovery-time target / actual recovery time × 100) | Actual readiness recovery following failure injection or stress completion |

`resilienceScore` is calculated only when the experiment completed and all five components have valid measurements:
`(availability + performance + error handling + detection + recovery) / 5`, rounded to two decimal places as a percentage out of 100. The five components each have equal 20% weight. No partial-weight renormalization or synthetic score is used. If a measurement is missing, invalid, times out, or has no event to measure (for example, no unhealthy stress condition was detected), the component and final score are unavailable and the response includes a reason. Actual scores can legitimately be 0 or 100; neither is inserted as a fallback.

The API, persistence layer, and history retain the actual numeric score and measurements. In the dashboard only, valid scores are rounded to two decimals and clamped to the visible 1–99% range; this is a display-only mapping, not the measured score. Unavailable scores use a neutral dash in the numeric slot. Score cards also show the underlying measurements used for each component.

Configure these policy thresholds in the backend environment:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `CHAOSGUARD_RESPONSE_TIME_DEGRADATION_TOLERANCE_PERCENT` | `20` | Full performance credit up to this percent above the measured baseline response time |
| `CHAOSGUARD_DETECTION_TARGET_MS` | `1000` | Detection-time target |
| `CHAOSGUARD_RECOVERY_TARGET_MS` | `5000` | Recovery-time target |

The response-time target is calculated separately for each experiment as `baseline response time × 1.20` by default. Performance is full credit at or below that limit and falls proportionally above it. Detection and recovery use `min(100, target duration / measured duration × 100)`. These are policy targets, not measurements. Detection and recovery targets must be positive; the response-time tolerance must be non-negative. A zero or negative measured duration is invalid and cannot earn a perfect score.

Availability is measured from timestamped Kubernetes API pod-readiness observations between the experiment's `startedAt` and `completedAt`. Samples outside that exact window, invalid windows, zero-pod samples, and conflicting duplicate timestamps are not used. Each observation counts the selected service's ready pods using its `app=<service>` selector. The service is considered available when at least one matching pod is Kubernetes Ready (which is gated by the `/health` HTTP readiness probe); multiple replicas are treated as redundant service endpoints, not averaged as separate percentage points. Each state is held forward only until the next observation or 2 seconds, whichever comes first. Longer gaps are unobserved, not treated as healthy or unhealthy. At least two valid observations and 80% valid-duration coverage are required. The reported percentage is healthy valid readiness observations divided by total valid readiness observations; the window, healthy/valid durations, sample counts, and coverage are persisted.

For Pod Failure, detection starts at the Kubernetes delete request and is recorded only when Kubernetes observes the selected pod absent, deleting, terminal, or not Ready. Recovery starts at that same injection timestamp and ends when the pre-injection ready-pod capacity is restored by a new ready replacement. Detection and recovery remain separate measurements. A detection timeout or recovery timeout has no successful duration and is not assigned a fabricated score. CPU and memory utilization, pod restart deltas, and Kubernetes container `lastState.terminated.reason=OOMKilled` snapshots (when exposed during readiness sampling) are experiment context only; intermediate OOM events that Kubernetes does not expose in the sampled status cannot be claimed. High utilization alone does not reduce or increase resilience.

Existing history is recalculated from timestamps and readiness observations already stored in each experiment; it is never filled with estimated readiness. For the latest legacy experiment, the backend also retries the exact Prometheus window once if a prior history load marked its HTTP measurement as predating instrumentation. If its source samples were not retained or were never collected, the metric remains unavailable.

All four service processes expose `/metrics`. `chaosguard_http_requests_total` counts application requests received; `/metrics` scrapes and Kubernetes `/health` readiness probes are excluded. `chaosguard_http_server_errors_total` counts completed HTTP 5xx responses. `chaosguard_http_client_errors_total` reports 4xx separately. Counters have only bounded `service` and status-class labels. PromQL `increase()` handles counter resets. The score's error-handling value is the successful fraction after subtracting both 4xx and 5xx responses from total requests over the exact experiment window. The ServiceMonitor scrapes every second; coverage uses a 2-second freshness window to allow one missed scrape. At least two counter samples and 80% scrape coverage are required. If no application requests occurred, the value is unavailable, not a presumed success. Missing or stale monitoring data is unavailable, never treated as a passing score.

Each experiment generates measured application traffic by default. **Generate measured traffic** is enabled by default and sends at most one GET per second through the Kubernetes Service proxy to that service's existing read-only API route (`/api/users`, `/api/orders`, `/api/payments`, or `/api/notifications`). Before injection it records three real baseline HTTP response-time samples. It may be explicitly disabled in the experiment configuration; in that case response-time and request-probe metrics are unavailable. Prometheus HTTP counters remain the source for in-experiment request success metrics and are not substituted with the probe's delivery counts. Probe traffic is part of the service's actual request volume, alongside any other real application traffic.

During CPU and memory stress, the backend records real Prometheus resource samples, readiness observations, baseline response time, in-experiment response time and Prometheus request outcomes. An unavailable CPU usage series does not prevent the CPU workload from running; CPU measurements remain unavailable rather than being inferred. Stress detection uses observed zero-ready service conditions and timestamped HTTP probe failures or responses exceeding the baseline response-time tolerance. Memory Stress also accepts a newly observed OOMKilled termination or pod restart during the active workload. OOM timestamps must fall within the experiment window, and restart counts are compared for the same pod identity across actual Kubernetes observations. High utilization alone is not a failure or detection. Recovery is measured from workload completion until two consecutive healthy readiness observations; a recovery timeout leaves the final score unavailable. If none of the defined unhealthy conditions is observed, no detection time is claimed. The final score is withheld until all five common components are valid.

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