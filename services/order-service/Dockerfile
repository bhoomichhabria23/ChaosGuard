FROM node:22-alpine

WORKDIR /app

COPY services/order-service/package*.json ./services/order-service/
RUN cd services/order-service && npm install --omit=dev

COPY services/order-service/server.js ./services/order-service/
COPY services/shared/http-metrics.js ./services/shared/http-metrics.js

WORKDIR /app/services/order-service

EXPOSE 3002

CMD ["npm", "start"]
