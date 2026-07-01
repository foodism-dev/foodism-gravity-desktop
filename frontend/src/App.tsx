import { useEffect, useMemo, useState } from "react";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell.tsx";
import { isLinKeTestSkipEnabled } from "@/lib/config.ts";
import {
  clearHandoffFromCurrentUrl,
  clearServerSession,
  clearSession,
  getStoredToken,
  getStoredUser,
  type FrontendUser,
} from "@/lib/auth.ts";
import { LandingPage } from "@/routes/LandingPage.tsx";
import { TicketDetailPage } from "@/routes/TicketDetailPage.tsx";
import { TicketsPage } from "@/routes/TicketsPage.tsx";

export interface AuthState {
  token: string | null;
  user: FrontendUser | null;
}

interface RouterContext {
  authState: AuthState;
  onSignOut: () => void;
  isLinKeTestSkipVisible: boolean;
  skipLinKeExternal: boolean;
  onSkipLinKeExternalChange: (enabled: boolean) => void;
}

const emptyAuthState: AuthState = {
  token: null,
  user: null,
};

const LIN_KE_TEST_SKIP_STORAGE_KEY = "proma_lin_ke_test_skip_enabled";

function readStoredLinKeTestSkip(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LIN_KE_TEST_SKIP_STORAGE_KEY) === "true";
}

function writeStoredLinKeTestSkip(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LIN_KE_TEST_SKIP_STORAGE_KEY, enabled ? "true" : "false");
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LandingRoute,
});

const ticketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tickets",
  component: TicketsRoute,
});

const ticketDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tickets/$ticketId",
  component: TicketDetailRoute,
});

const fallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <Navigate to="/" />,
});

const routeTree = rootRoute.addChildren([indexRoute, ticketsRoute, ticketDetailRoute, fallbackRoute]);

const router = createRouter({
  routeTree,
  context: {
    authState: emptyAuthState,
    onSignOut: () => undefined,
    isLinKeTestSkipVisible: false,
    skipLinKeExternal: false,
    onSkipLinKeExternalChange: () => undefined,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(() => getStoredUser());
  const linKeTestSkipVisible = isLinKeTestSkipEnabled();
  const [skipLinKeExternal, setSkipLinKeExternal] = useState(() => linKeTestSkipVisible && readStoredLinKeTestSkip());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoffToken = params.get("handoff");
    if (!handoffToken) {
      return;
    }

    clearHandoffFromCurrentUrl();
  }, []);

  const authState = useMemo<AuthState>(
    () => ({
      token,
      user,
    }),
    [token, user],
  );

  function handleSignOut() {
    void clearServerSession();
    clearSession();
    setToken(null);
    setUser(null);
    void router.navigate({ to: "/" });
  }

  function handleSkipLinKeExternalChange(enabled: boolean) {
    setSkipLinKeExternal(enabled);
    writeStoredLinKeTestSkip(enabled);
  }

  return (
    <RouterProvider
      router={router}
      context={{
        authState,
        onSignOut: handleSignOut,
        isLinKeTestSkipVisible: linKeTestSkipVisible,
        skipLinKeExternal: linKeTestSkipVisible && skipLinKeExternal,
        onSkipLinKeExternalChange: handleSkipLinKeExternalChange,
      }}
    />
  );
}

function RootLayout() {
  const { authState, onSignOut } = rootRoute.useRouteContext();
  return (
    <AppShell authState={authState} onSignOut={onSignOut}>
      <Outlet />
    </AppShell>
  );
}

function LandingRoute() {
  const { authState } = rootRoute.useRouteContext();
  return <LandingPage authState={authState} />;
}

function TicketsRoute() {
  const {
    authState,
    onSignOut,
    isLinKeTestSkipVisible,
    skipLinKeExternal,
    onSkipLinKeExternalChange,
  } = rootRoute.useRouteContext();
  return (
    <TicketsPage
      authState={authState}
      onSignOut={onSignOut}
      isLinKeTestSkipVisible={isLinKeTestSkipVisible}
      skipLinKeExternal={skipLinKeExternal}
      onSkipLinKeExternalChange={onSkipLinKeExternalChange}
    />
  );
}

function TicketDetailRoute() {
  const { authState, isLinKeTestSkipVisible, skipLinKeExternal } = rootRoute.useRouteContext();
  const { ticketId } = ticketDetailRoute.useParams();
  return (
    <TicketDetailPage
      authState={authState}
      ticketId={ticketId}
      isLinKeTestSkipVisible={isLinKeTestSkipVisible}
      skipLinKeExternal={skipLinKeExternal}
    />
  );
}
