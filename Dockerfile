FROM node:22-alpine
WORKDIR /app

# Install curl (for Coolify healthchecks) and openssl (required by Prisma on Alpine)
RUN apk add --no-cache curl openssl

# 1. Copy dependency files first to maximize Docker layer caching
COPY package*.json ./
RUN npm install

# 2. Copy ONLY the prisma folder next to cache the Prisma Client generation
COPY prisma ./prisma/

# Define build arguments
ARG BUILD_DATABASE_URL="file:./dev.db"
ARG DATABASE_URL
ARG DATABASE_URL_DOCKER
ARG META_NAME
ARG META_DESCRIPTION
ARG CRYPTO_SECRET
ARG TMDB_API_KEY
ARG CAPTCHA=false
ARG CAPTCHA_CLIENT_KEY
ARG TRAKT_CLIENT_ID
ARG TRAKT_SECRET_ID
ARG NODE_ENV=production

# Persist only non-sensitive runtime env vars (do NOT persist real DATABASE_URL)
ENV DATABASE_URL_DOCKER=${DATABASE_URL_DOCKER}
ENV META_NAME=${META_NAME}
ENV META_DESCRIPTION=${META_DESCRIPTION}
ENV CRYPTO_SECRET=${CRYPTO_SECRET}
ENV TMDB_API_KEY=${TMDB_API_KEY}
ENV CAPTCHA=${CAPTCHA}
ENV CAPTCHA_CLIENT_KEY=${CAPTCHA_CLIENT_KEY}
ENV TRAKT_CLIENT_ID=${TRAKT_CLIENT_ID}
ENV TRAKT_SECRET_ID=${TRAKT_SECRET_ID}
ENV NODE_ENV=${NODE_ENV}

# 3. Generate Prisma client using the build-only placeholder URL
RUN DATABASE_URL=${BUILD_DATABASE_URL} npx prisma generate

# 4. Copy the rest of the application code AFTER dependencies and Prisma are sorted
COPY . .

# Build the application
RUN npm run build

EXPOSE 3000

# Run migrations and start the server (kept exactly as you requested)
CMD ["sh", "-c", "npx prisma migrate deploy && node .output/server/index.mjs"]
