import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import Works from "./pages/Works";
import Explore from "./pages/Explore";
import Analytics from "./pages/Analytics";
import Studio from "./pages/Studio";
import Editor from "./pages/Editor";
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
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<Works />} />
            <Route path="explore" element={<Explore />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="studio/:workId" element={<Studio />} />
            <Route path="editor/:workId" element={<Editor />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
