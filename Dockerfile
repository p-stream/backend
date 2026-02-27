FROM node:22-alpine
WORKDIR /app

# Install curl (for Coolify healthchecks) and openssl (required by Prisma on Alpine)
RUN apk add --no-cache curl openssl

# 1. Copy dependency files first to maximize Docker layer caching
COPY package*.json ./
RUN npm install

# 2. Copy All folders for future proofing incase of custom setups later on
COPY . .

# 3. Define build arguments (ARGs). 
# These will be available for `prisma generate` and `npm run build`, 
ARG DATABASE_URL=postgresql://CHANGETHISDONOTFOLLOWTHIS:5432/placeholder_db
ARG META_NAME
ARG META_DESCRIPTION
ARG CRYPTO_SECRET
ARG TMDB_API_KEY
ARG CAPTCHA=false
ARG CAPTCHA_CLIENT_KEY
ARG TRAKT_CLIENT_ID
ARG TRAKT_SECRET_ID

# 4. Generate Prisma client using the build-only placeholder URL
RUN DATABASE_URL=${DATABASE_URL} npx prisma generate

# 5. Build the application (it will use the ARGs above during compilation)
RUN npm run build

# 6. Set ONLY the essential, safe runtime variable.
ENV NODE_ENV=production

EXPOSE 3000

# Run migrations and start the server
# Users MUST provide the real variables via Docker Run / Compose
CMD ["sh", "-c", "npx prisma migrate deploy && node .output/server/index.mjs"]
