FROM node:18-alpine

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy backend files
COPY . .

# Expose port (defaults to 3000, can be overridden by environment variable)
EXPOSE 3000

CMD ["npm", "start"]
