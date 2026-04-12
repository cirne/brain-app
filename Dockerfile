FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---

FROM node:22-alpine

WORKDIR /app

# git is needed for wiki clone/pull
RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY start.sh ./
RUN chmod +x start.sh

# ripmail binary is expected at /usr/local/bin/ripmail
# Mount it via Fly.io volume or bake it in at build time:
# COPY ripmail /usr/local/bin/ripmail
# RUN chmod +x /usr/local/bin/ripmail

RUN mkdir -p /wiki /data

EXPOSE 3000

CMD ["./start.sh"]
