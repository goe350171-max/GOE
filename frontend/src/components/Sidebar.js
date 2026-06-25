import { Link, useLocation } from "react-router-dom";

export default function Sidebar() {
  const location = useLocation();

  const active = (path) => location.pathname === path;

  return (
    <aside className="w-56 border-r border-zinc-300 bg-white min-h-[calc(100vh-64px)] p-4">
      <nav className="flex flex-col gap-2">

        <Link
          to="/"
          className={`px-4 py-3 ${
            active("/")
              ? "bg-black text-white"
              : "hover:bg-zinc-100"
          }`}
        >
          Launchpad
        </Link>

        <Link
          to="/explorer"
          className={`px-4 py-3 ${
            active("/explorer")
              ? "bg-black text-white"
              : "hover:bg-zinc-100"
          }`}
        >
          Explorer
        </Link>

        <Link
          to="/airdrop"
          className={`px-4 py-3 ${
            active("/airdrop")
              ? "bg-black text-white"
              : "hover:bg-zinc-100"
          }`}
        >
          Airdrop
        </Link>

      </nav>
    </aside>
  );
}
