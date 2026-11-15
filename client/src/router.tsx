import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";

import { HomePage } from "./routes/home";
import { LoginPage } from "./routes/login";
import { RootLayout } from "./routes/root";
import { UsernamePage } from "./routes/username";
import { useAuth } from "./stores/auth";

// Sends you to the right page for your auth state:
// logged out → /login, no username → /username, otherwise → /
function guard(page: "login" | "username" | "home") {
  const { refreshToken, user } = useAuth.getState();
  const want = !refreshToken ? "/login" : !user?.username ? "/username" : "/";
  const here = page === "login" ? "/login" : page === "username" ? "/username" : "/";
  // TanStack Router's redirect() is meant to be thrown.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (want !== here) throw redirect({ to: want });
}

const rootRoute = createRootRoute({ component: RootLayout });

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    beforeLoad: () => guard("login"),
    component: LoginPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/username",
    beforeLoad: () => guard("username"),
    component: UsernamePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => guard("home"),
    component: HomePage,
  }),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// If tokens get wiped (refresh failed, logout), go back to login.
useAuth.subscribe((s, prev) => {
  if (prev.refreshToken && !s.refreshToken) void router.navigate({ to: "/login" });
});
