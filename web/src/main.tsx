import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import App from "./App";
import Works from "./pages/Works";
import Explore from "./pages/Explore";
import Analytics from "./pages/Analytics";
import Studio from "./pages/Studio";
import Editor from "./pages/Editor";
import NotFound from "./pages/NotFound";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/typography.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* R126 F607 — propagate the user's OS-level `prefers-reduced-motion`
          setting into framer-motion. With `reducedMotion="user"`, every
          <motion.*> descendant automatically transitions with duration 0
          and skips transform animations when PRM is on. This is the JS
          half of M222's dual-track PRM defense (CSS side lives in
          globals.css). Without this wrapper, the 9 dialog/sidebar
          motion components silently bypassed the global @media rule. */}
      <MotionConfig reducedMotion="user">
        {/* e2e-report F2 (Round 01): opt-in to react-router v7 future flags
            to silence the console warning that's been there since the
            first round of testing. Both flags are safe with our current
            route table (no startTransition-incompatible Suspense usage). */}
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route element={<App />}>
              <Route index element={<Works />} />
              <Route path="works" element={<Works />} />
              <Route path="explore" element={<Explore />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="studio/:workId" element={<Studio />} />
              <Route path="editor/:workId" element={<Editor />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  </React.StrictMode>,
);
