FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @neuron/web
ENV NODE_ENV=production
EXPOSE 3000
