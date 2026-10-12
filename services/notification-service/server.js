import express from 'express';
import { createHttpMetrics } from '../shared/http-metrics.js';

const app = express();
const PORT = process.env.PORT || 3004;
const metrics = createHttpMetrics('notification-service');

app.use(metrics.middleware);
app.use(express.json());
app.get('/metrics', metrics.metricsHandler);

app.get('/health', (req, res) => {
  res.json({
    service: 'notification-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/notifications', (req, res) => {
  res.json({
    service: 'notification-service',
    message: 'Notification service is running'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Notification Service running on port ${PORT}`);
});
