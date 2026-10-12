import express from 'express';
import { createHttpMetrics } from '../shared/http-metrics.js';

const app = express();
const PORT = process.env.PORT || 3002;
const metrics = createHttpMetrics('order-service');

app.use(metrics.middleware);
app.use(express.json());
app.get('/metrics', metrics.metricsHandler);

app.get('/health', (req, res) => {
  res.json({
    service: 'order-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/orders', (req, res) => {
  res.json({
    service: 'order-service',
    message: 'Order service is running'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Order Service running on port ${PORT}`);
});
