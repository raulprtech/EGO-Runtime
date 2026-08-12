FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY . .

# Build application
RUN npm run build

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
