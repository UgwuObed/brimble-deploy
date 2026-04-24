FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html

# Proxy /api to the backend so the browser never hits a different origin
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
