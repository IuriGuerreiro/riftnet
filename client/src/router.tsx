import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";

import { HomePage } from "./routes/home";
import { LoginPage } from "./routes/login";
import { RootLayout } from "./routes/root";
import { UsernamePage } from "./routes/username";
import { readWorkspaceSearch } from "./schemas/workspace";
import { useAuth } from "./stores/auth";

function guard(page: "login" | "username" | "home", invite: string | undefined) {
  const { refreshToken, user } = useAuth.getState();
  const want = !refreshToken ? "/login" : !user?.username ? "/username" : "/";
  const here = page === "login" ? "/login" : page === "username" ? "/username" : "/";
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (want !== here) throw redirect({ to: want, search: { invite } });
}

const rootRoute = createRootRoute({
  component: RootLayout,
  validateSearch: readWorkspaceSearch,
});

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    beforeLoad: ({ search }) => guard("login", readWorkspaceSearch(search).invite),
    component: LoginPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/username",
    beforeLoad: ({ search }) => guard("username", readWorkspaceSearch(search).invite),
    component: UsernamePage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: ({ search }) => guard("home", readWorkspaceSearch(search).invite),
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
  if (prev.refreshToken && !s.refreshToken) {
    const { invite } = readWorkspaceSearch(router.state.location.search);
    void router.navigate({ to: "/login", search: { invite } });
  }
});
