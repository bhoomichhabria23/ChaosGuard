FROM node:22-alpine

WORKDIR /app

COPY services/notification-service/package*.json ./services/notification-service/
RUN cd services/notification-service && npm install --omit=dev

COPY services/notification-service/server.js ./services/notification-service/
COPY services/shared/http-metrics.js ./services/shared/http-metrics.js

WORKDIR /app/services/notification-service

EXPOSE 3004

CMD ["npm", "start"]
