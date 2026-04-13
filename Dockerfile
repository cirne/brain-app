FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---

FROM ubuntu:24.04

WORKDIR /app

# Node.js 22 + deps; ubuntu:24.04 provides GLIBC 2.39 needed by ripmail
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates git python3 && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://raw.githubusercontent.com/cirne/ripmail/main/install.sh | INSTALL_PREFIX=/usr/local/bin bash
RUN which ripmail && ripmail --help

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY start.sh ./
RUN chmod +x start.sh

RUN mkdir -p /wiki /data

EXPOSE 4000

CMD ["./start.sh"]
