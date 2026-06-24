import { ClipboardList, Home, LogOut, ShieldCheck, TicketCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type { AuthState } from "@/App.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

interface AppShellProps {
  authState: AuthState;
  children: React.ReactNode;
  onSignOut: () => void;
}

const navItems = [
  { to: "/", label: "入口", icon: Home },
  { to: "/tickets", label: "工单", icon: ClipboardList },
] as const;

export function AppShell({ authState, children, onSignOut }: AppShellProps) {
  return (
    <div className="min-h-screen">
      <header className="page-band sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <TicketCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Proma 工单台</div>
              <div className="text-xs text-muted-foreground">SupplyGoods 审核与回调跟进</div>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Button key={item.to} variant="ghost" size="sm" asChild>
                <Link
                  to={item.to}
                  activeProps={{ className: "bg-muted text-foreground" }}
                  inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
                  className={cn("rounded-md")}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {authState.token ? (
              <>
                <Badge variant="success" className="hidden sm:inline-flex">
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  {authState.user?.name ?? "已登录"}
                </Badge>
                <Button variant="ghost" size="icon" onClick={onSignOut} title="退出登录">
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Badge variant={authState.isHandoffLoading ? "warning" : "muted"}>
                {authState.isHandoffLoading ? "桥接中" : "未桥接"}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
