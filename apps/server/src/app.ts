import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";
import {
  authenticateLogin,
  createLoginResponse,
  getJwtSecret,
  isLoginRequest,
  resolveUserFromTokenPayload,
  type AuthTokenPayload,
} from "./auth.ts";
import { getDefaultUserRepository, type UserRepository } from "./users.ts";

interface ServerStatus {
  name: string;
  status: "ok";
  uptime: number;
  timestamp: string;
}

interface ServerVariables {
  jwtPayload: AuthTokenPayload;
}

interface ServerAppOptions {
  userRepository?: UserRepository | null;
}

export function createServerApp(options: ServerAppOptions = {}) {
  const app = new Hono<{ Variables: ServerVariables }>();
  const jwtSecret = getJwtSecret();
  const userRepository = options.userRepository ?? getDefaultUserRepository();

  app.use("/api/*", cors());

  app.get("/health", (context) => {
    return context.json({ status: "ok" });
  });

  app.get("/api/status", (context) => {
    const status: ServerStatus = {
      name: "@proma/server",
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return context.json(status);
  });

  app.post("/api/auth/login", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "Bad Request", message: "请求体必须是 JSON" }, 400);
    }

    if (!isLoginRequest(body)) {
      return context.json({ error: "Bad Request", message: "账号和密码不能为空" }, 400);
    }

    const user = await authenticateLogin(body, userRepository);
    if (!user) {
      console.warn(`[认证] 登录失败: ${body.username.trim() || "<empty>"}`);
      return context.json({ error: "Unauthorized", message: "账号或密码错误" }, 401);
    }

    console.log(`[认证] 用户已登录: ${user.username}`);
    return context.json(await createLoginResponse(user, jwtSecret));
  });

  app.use(
    "/api/me",
    jwt({
      secret: jwtSecret,
      alg: "HS256",
    }),
  );

  app.get("/api/me", async (context) => {
    const payload = context.get("jwtPayload");
    return context.json({ user: await resolveUserFromTokenPayload(payload, userRepository) });
  });

  app.notFound((context) => {
    return context.json(
      {
        error: "Not Found",
        message: "请求的资源不存在",
      },
      404,
    );
  });

  return app;
}

export type ServerApp = ReturnType<typeof createServerApp>;
