import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";

import { HomePage } from "./routes/home";
import { LoginPage } from "./routes/login";
import { RootLayout } from "./routes/root";
import { UsernamePage } from "./routes/username";
import { useAuth } from "./stores/auth";

function guard(page: "login" | "username" | "home") {
  const { refreshToken, user } = useAuth.getState();
  const want = !refreshToken ? "/login" : !user?.username ? "/username" : "/";
  const here = page === "login" ? "/login" : page === "username" ? "/username" : "/";
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

useAuth.subscribe((s, prev) => {
  if (prev.refreshToken && !s.refreshToken) void router.navigate({ to: "/login" });
});
