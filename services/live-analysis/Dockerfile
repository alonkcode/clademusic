# Build from the repository root so the shared DSP modules are in the context:
#   docker build -f services/live-analysis/Dockerfile -t clade-live-analysis .
FROM oven/bun:1-alpine
WORKDIR /app

# The service and the DSP it reuses unmodified. No dependencies to install:
# it uses Bun's built-in WebSocket server and fetch.
COPY services/live-analysis ./services/live-analysis
COPY supabase/functions/_shared/dsp ./supabase/functions/_shared/dsp

ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER bun

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

CMD ["bun", "services/live-analysis/main.ts"]
