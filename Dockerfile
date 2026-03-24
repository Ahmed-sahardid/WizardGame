FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

FROM gcr.io/distroless/nodejs20-debian12:nonroot

WORKDIR /app

COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["server/server.js"]
