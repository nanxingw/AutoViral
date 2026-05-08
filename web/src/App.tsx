import { Outlet, useLocation } from "react-router-dom";
import { TopNav } from "@/ui/TopNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function App() {
  // Reset the boundary on route change so a previously-crashed page
  // doesn't keep showing the fallback after the user navigates elsewhere.
  // The location key flips → ErrorBoundary unmounts/remounts with fresh
  // state. TopNav stays outside the boundary so navigation always works
  // even when a route subtree crashed.
  const location = useLocation();
  return (
    <>
      <TopNav />
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
    </>
  );
}
