# ── Build Stage ─────────────────────────────────────────────
FROM node:20-slim

# Create app directory
WORKDIR /app

# Install dependencies first (layer cache optimization)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Do NOT copy data.json — data lives in GCS bucket on Cloud Run
# (Local dev uses the local data.json file)

# Cloud Run sets PORT=8080 by default
ENV PORT=8080

# Start the server
CMD ["node", "server.js"]
