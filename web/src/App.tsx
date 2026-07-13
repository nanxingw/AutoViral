import { Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastViewport } from "@/components/ToastViewport";
import { GlobalSettingsHost } from "@/features/settings/GlobalSettingsHost";
import { WorksHeader } from "@/features/works/WorksHeader";

export default function App() {
  // Reset the boundary on route change so a previously-crashed page
  // doesn't keep showing the fallback after the user navigates elsewhere.
  // The location key flips → ErrorBoundary unmounts/remounts with fresh
  // state. The application shell stays outside the boundary so global
  // settings remain available even when a route subtree crashed.
  const location = useLocation();
  const isWorks = location.pathname === "/" || location.pathname === "/works";
  return (
    <>
      {isWorks ? <WorksHeader /> : null}
      <GlobalSettingsHost />
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
      {/* R32: global toast layer — last-resort surfacing of unhandled
          promise rejections that escape every other catch (R19-R24
          inline UIs cover the known paths). Mounted outside the route
          boundary so a route crash + unhandled rejection both still
          show toasts. */}
      <ToastViewport />
    </>
  );
}
