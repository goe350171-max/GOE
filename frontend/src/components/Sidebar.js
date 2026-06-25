import { Link, useLocation } from "react-router-dom";

export default function Sidebar() {
  const location = useLocation();

  const active = (path) => location.pathname === path;

  return (
  <aside className="w-56 border-r border-zinc-300 bg-background min-h-[calc(100vh-64px)] p-4">
    <nav className="flex flex-col gap-2">

      <Link
        to="/"
        className={`px-4 py-2 text-sm font-medium tracking-normal transition-all duration-200 ${
          active("/")
            ? "bg-black text-white"
            : "text-foreground hover:bg-zinc-200"
        }`}
      >
        Launchpad
      </Link>

      <Link
        to="/explorer"
        className={`px-4 py-2 text-sm font-medium tracking-normal transition-all duration-200 ${
          active("/explorer")
            ? "bg-black text-white"
            : "text-foreground hover:bg-zinc-200"
        }`}
      >
        Explorer
      </Link>

      <Link
        to="/airdrop"
        className={`px-4 py-2 text-sm font-medium tracking-normal transition-all duration-200 ${
          active("/airdrop")
            ? "bg-black text-white"
            : "text-foreground hover:bg-zinc-200"
        }`}
      >
        Airdrop
      </Link>

    </nav>
  </aside>
);
