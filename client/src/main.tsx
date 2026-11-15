import "./platform"; // must be first: stores read it when they load
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { useAuth } from "./stores/auth";
import "./index.css";

// Keep tabs in sync: when another tab logs in, refreshes or logs out,
// reload the tokens from localStorage.
window.addEventListener("storage", (e) => {
  if (e.key === "auth") void useAuth.persist.rehydrate();
});

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
