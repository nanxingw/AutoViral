import { Routes, Route, Navigate } from "react-router-dom";
import App from "./App";
import Works from "./pages/Works";
import Studio from "./pages/Studio";
import Editor from "./pages/Editor";
import NotFound from "./pages/NotFound";

/** Central route table (extracted from main.tsx so it's unit-testable).
 *  PRD-0013 S4 — the retired discovery/analytics pages redirect old
 *  bookmarks to Works; every other unknown path still 404s (no blanket
 *  redirect that would swallow typos). */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<App />}>
        <Route index element={<Works />} />
        <Route path="works" element={<Works />} />
        <Route path="explore" element={<Navigate replace to="/" />} />
        <Route path="analytics" element={<Navigate replace to="/" />} />
        <Route path="studio/:workId" element={<Studio />} />
        <Route path="editor/:workId" element={<Editor />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
