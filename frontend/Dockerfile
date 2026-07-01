FROM oven/bun:1.3.9-alpine AS builder

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile --filter @proma/frontend

WORKDIR /app/frontend

ARG VITE_API_BASE_URL=http://localhost:8787
ARG VITE_SSO_LOGIN_URL=
ARG VITE_LIN_KE_TEST_SKIP_ENABLED=false

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_SSO_LOGIN_URL=${VITE_SSO_LOGIN_URL}
ENV VITE_LIN_KE_TEST_SKIP_ENABLED=${VITE_LIN_KE_TEST_SKIP_ENABLED}

RUN bun run build

FROM oven/bun:1.3.9-alpine

WORKDIR /app

ENV PORT=4173

COPY --from=builder /app/frontend/dist ./dist
COPY frontend/docker/serve-static.ts ./serve-static.ts
COPY frontend/docker/write-runtime-config.ts ./write-runtime-config.ts

EXPOSE 4173

CMD ["sh", "-lc", "bun /app/write-runtime-config.ts && exec bun /app/serve-static.ts"]
