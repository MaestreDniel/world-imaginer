FROM node:20-bullseye-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5175

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5175"]
