# ripmail is built from the monorepo (`ripmail/` workspace member), not the retired public installer.
FROM rust:1-bookworm AS ripmail
WORKDIR /w
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY ripmail ./ripmail
COPY desktop ./desktop
COPY .cargo ./.cargo

RUN cargo build -p ripmail --release \
  && install -m 755 target/release/ripmail /usr/local/bin/ripmail \
  && ripmail --help

# ---

FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y ca-certificates git openssh-client python3 bash \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ripmail /usr/local/bin/ripmail /usr/local/bin/ripmail
RUN ripmail --help

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY start.sh ./
RUN chmod +x start.sh

RUN mkdir -p /wiki /ripmail

# ripmail stores config + SQLite under RIPMAIL_HOME (see start.sh for optional non-interactive setup)
ENV RIPMAIL_HOME=/ripmail

EXPOSE 4000

CMD ["./start.sh"]
