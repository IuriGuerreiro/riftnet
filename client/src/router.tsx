import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { useAuth } from "./stores/auth";
import { RootLayout } from "./routes/root";
import { LoginPage } from "./routes/login";
import { UsernamePage } from "./routes/username";
import { HomePage } from "./routes/home";

// Sends you to the right page for your auth state:
// logged out → /login, no username → /username, otherwise → /
function guard(page: "login" | "username" | "home") {
  const { refreshToken, user } = useAuth.getState();
  const want = !refreshToken ? "/login" : !user?.username ? "/username" : "/";
  const here = page === "login" ? "/login" : page === "username" ? "/username" : "/";
  if (want !== here) throw redirect({ to: want });
}

const rootRoute = createRootRoute({ component: RootLayout });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/login", beforeLoad: () => guard("login"), component: LoginPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/username",
    beforeLoad: () => guard("username"),
    component: UsernamePage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/", beforeLoad: () => guard("home"), component: HomePage }),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// If tokens get wiped (refresh failed, logout), go back to login.
useAuth.subscribe((s, prev) => {
  if (prev.refreshToken && !s.refreshToken) router.navigate({ to: "/login" });
});
