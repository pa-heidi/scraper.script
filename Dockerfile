FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /usr/src/app

# Install dependencies first (leverage Docker layer cache)
COPY package*.json tsconfig.json package-scripts.json ./
RUN npm ci

# Copy source
COPY . .

# Build TypeScript -> dist/
RUN npm run build

ENV NODE_ENV=production \
    LOG_LEVEL=info

# Default entrypoint: interactive plan generator CLI
# Override the command if you want to run a different script
CMD ["node", "dist/scripts/generate-plan.js"]
