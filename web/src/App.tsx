import { Outlet } from "react-router-dom";
import { TopNav } from "@/ui/TopNav";

export default function App() {
  return (
    <>
      <TopNav />
      <Outlet />
    </>
  );
}
