FROM node:22-alpine

WORKDIR /app

COPY services/payment-service/package*.json ./services/payment-service/
RUN cd services/payment-service && npm install --omit=dev

COPY services/payment-service/server.js ./services/payment-service/
COPY services/shared/http-metrics.js ./services/shared/http-metrics.js

WORKDIR /app/services/payment-service

EXPOSE 3003

CMD ["npm", "start"]
