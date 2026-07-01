import { ArrowRight, Boxes, DatabaseZap, Link2, ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type { AuthState } from "@/App.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { getApiBaseUrl } from "@/lib/config.ts";

interface LandingPageProps {
  authState: AuthState;
}

export function LandingPage({ authState }: LandingPageProps) {
  const healthUrl = `${getApiBaseUrl()}/health`;

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-lg bg-white p-6 shadow-panel sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Web 工单入口</Badge>
            <Badge variant={authState.token ? "success" : "muted"}>
              {authState.token ? "已接入 PC 登录态" : "等待 Web 登录会话"}
            </Badge>
          </div>
          <div className="mt-8 max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">Proma 工单台</h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              面向 SupplyGoods 回调、审核状态、附件下载和补查落库链路的工作台。Web SSO 登录完成后，
              后端通过 HttpOnly Cookie 维持浏览器会话。
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/tickets">
                查看工单
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={healthUrl} target="_blank" rel="noreferrer">
                检查后端
              </a>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              Web 登录会话
            </CardTitle>
            <CardDescription>浏览器会话由后端安全 Cookie 维护。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
              Set-Cookie: proma_web_session=...; HttpOnly
            </div>
            <div className="rounded-md bg-accent p-3 text-accent-foreground">
              Web 端不读取 Cookie 内容，请求接口时由浏览器自动携带会话。
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard icon={DatabaseZap} title="回调落库" value="supply_goods_id 唯一键" />
        <StatusCard icon={ShieldCheck} title="业务状态" value="businessStatus" />
        <StatusCard icon={Boxes} title="附件链路" value="R2 镜像链接" />
      </section>
    </div>
  );
}

interface StatusCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
}

function StatusCard({ icon: Icon, title, value }: StatusCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm text-muted-foreground">{title}</div>
          <div className="mt-1 font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
