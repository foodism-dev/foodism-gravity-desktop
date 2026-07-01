import { extname, join, normalize } from "node:path";

const rootDir = "/app/dist";
const fallbackFile = join(rootDir, "index.html");

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function readPort(): number {
  const value = Number.parseInt(Bun.env.PORT?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 4173;
}

function resolveStaticPath(url: URL): string {
  const decodedPath = decodeURIComponent(url.pathname);
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  return join(rootDir, normalizedPath);
}

async function serveFile(pathname: string): Promise<Response | null> {
  const file = Bun.file(pathname);
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: {
      "content-type": mimeTypes[extname(pathname)] ?? "application/octet-stream",
    },
  });
}

const port = readPort();

Bun.serve({
  hostname: "0.0.0.0",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const staticResponse = await serveFile(resolveStaticPath(url));
    if (staticResponse) return staticResponse;

    const fallbackResponse = await serveFile(fallbackFile);
    if (fallbackResponse) return fallbackResponse;

    return new Response("前端构建产物不存在", { status: 500 });
  },
});

console.log(`[前端] 静态服务已启动：http://0.0.0.0:${port}`);
