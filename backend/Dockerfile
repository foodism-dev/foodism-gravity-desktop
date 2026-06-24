FROM oven/bun:1.3.9-alpine

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --filter @proma/server

WORKDIR /app/backend

EXPOSE 8787

CMD ["bun", "run", "start"]
