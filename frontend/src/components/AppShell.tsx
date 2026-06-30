import { ClipboardList, Home, LogOut } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";

import type { AuthState } from "@/App.tsx";
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const shouldHideHeader = shouldHideAppShellHeader(pathname);

  return (
    <div className="min-h-screen">
      {shouldHideHeader ? null : (
        <header className="page-band sticky top-0 z-40">
          <div className="mx-auto grid h-14 max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:px-8">
            <AppNavigation className="col-start-2 hidden md:flex" />
            <AppAuthControls authState={authState} onSignOut={onSignOut} className="col-start-3 justify-end" />
          </div>
        </header>
      )}

      <main className={getAppShellMainClassName(pathname)}>
        {children}
      </main>
    </div>
  );
}

export function getAppShellMainClassName(pathname: string): string {
  if (isTicketDetailPath(pathname)) {
    return "w-full max-w-none px-0 py-0";
  }
  return cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", shouldHideAppShellHeader(pathname) ? "py-3" : "py-6");
}

export function shouldHideAppShellHeader(pathname: string): boolean {
  return pathname === "/tickets" || pathname.startsWith("/tickets/");
}

function isTicketDetailPath(pathname: string): boolean {
  return pathname.startsWith("/tickets/");
}

export function AppNavigation({ className }: { className?: string }) {
  return (
    <nav className={cn("items-center gap-1", className)}>
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
  );
}

export function AppAuthControls({
  authState,
  onSignOut,
  className,
}: {
  authState: AuthState;
  onSignOut: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {authState.token ? (
        <Button variant="ghost" size="icon" onClick={onSignOut} title="退出登录">
          <LogOut className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
