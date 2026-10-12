import express from 'express';
import { createHttpMetrics } from '../shared/http-metrics.js';

const app = express();
const PORT = process.env.PORT || 3003;
const metrics = createHttpMetrics('payment-service');

app.use(metrics.middleware);
app.use(express.json());
app.get('/metrics', metrics.metricsHandler);

app.get('/health', (req, res) => {
  res.json({
    service: 'payment-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/payments', (req, res) => {
  res.json({
    service: 'payment-service',
    message: 'Payment service is running'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Payment Service running on port ${PORT}`);
});
