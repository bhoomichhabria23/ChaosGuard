FROM node:22-alpine

WORKDIR /app

COPY services/user-service/package*.json ./services/user-service/
RUN cd services/user-service && npm install --omit=dev

COPY services/user-service/server.js ./services/user-service/
COPY services/shared/http-metrics.js ./services/shared/http-metrics.js

WORKDIR /app/services/user-service

EXPOSE 3001

CMD ["npm", "start"]
