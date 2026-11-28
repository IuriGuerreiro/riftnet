import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";

import { DevSwitcher } from "@/components/DevSwitcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdeptLayout } from "@/layouts/AdeptLayout";
import { ForgotScreen } from "@/screens/ForgotScreen";
import { LoadingScreen } from "@/screens/LoadingScreen";
import { readLoadingSearch } from "@/screens/loadingSearch";
import { LoginScreen } from "@/screens/LoginScreen";
import { RegisterScreen } from "@/screens/RegisterScreen";
import { UsernameScreen } from "@/screens/UsernameScreen";
import { VerifyScreen } from "@/screens/VerifyScreen";

const rootRoute = createRootRoute({
  errorComponent: () => (
    <div className="grid h-full place-content-center gap-3 text-center">
      <h1 className="text-xl font-semibold">Something broke</h1>
      <a href="/app" className="text-brand-text hover:underline">
        Reload Riftnet
      </a>
    </div>
  ),
  component: () => (
    <TooltipProvider>
      <Outlet />
      <DevSwitcher />
    </TooltipProvider>
  ),
});

const loadingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/loading",
  validateSearch: readLoadingSearch,
});

function LoadingPage() {
  const search = readLoadingSearch(loadingRoute.useSearch() as unknown);
  return <LoadingScreen key={JSON.stringify(search)} {...search} />;
}
loadingRoute.update({ component: LoadingPage });

const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Navigate to="/loading" replace />,
  }),
  loadingRoute,
  createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/register", component: RegisterScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/forgot", component: ForgotScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/verify", component: VerifyScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/username", component: UsernameScreen }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/app",
    component: AdeptLayout,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/adept",
    component: () => <Navigate to="/app" replace />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/classic",
    component: () => <Navigate to="/app" replace />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/inbox",
    component: () => <Navigate to="/app" replace />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/live",
    component: () => <Navigate to="/app" replace />,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/focus",
    component: () => <Navigate to="/app" replace />,
  }),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
