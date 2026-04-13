FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl ca-certificates git openssh-client python3 bash
RUN curl -fsSL https://raw.githubusercontent.com/cirne/ripmail/main/install.sh | INSTALL_PREFIX=/usr/local/bin bash
RUN which ripmail && ripmail --help

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY start.sh ./
RUN chmod +x start.sh

RUN mkdir -p /wiki /ripmail

# ripmail defaults to ~/.ripmail; in containers HOME is /root — mount host index at /ripmail and point here
ENV RIPMAIL_HOME=/ripmail

EXPOSE 4000

CMD ["./start.sh"]
