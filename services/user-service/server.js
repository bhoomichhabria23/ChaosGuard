import express from 'express';
import { createHttpMetrics } from '../shared/http-metrics.js';

const app = express();
const PORT = process.env.PORT || 3001;
const metrics = createHttpMetrics('user-service');

app.use(metrics.middleware);
app.use(express.json());
app.get('/metrics', metrics.metricsHandler);

app.get('/health', (req, res) => {
  res.json({
    service: 'user-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/users', (req, res) => {
  res.json({
    service: 'user-service',
    message: 'User service is running'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`User Service running on port ${PORT}`);
});
