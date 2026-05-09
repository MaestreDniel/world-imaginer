FROM node:20-bullseye-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5182

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5182"]
