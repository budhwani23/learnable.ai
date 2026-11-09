// import "./ticker.css";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const Header = () => {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={[
        "sticky top-0 z-50 border-b transition-all",
        "bg-white/60 dark:bg-neutral-900/50 backdrop-blur-xl",
        scrolled
          ? "shadow-[0_8px_24px_rgba(2,6,23,0.08)] border-emerald-600/15"
          : "shadow-none border-transparent",
      ].join(" ")}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-20">
        <div className="flex h-14 sm:h-[60px] items-center justify-between">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2 group">
            <img
              src="/hopenote-logo.png"
              alt="Hopnote"
              className="h-8 w-10 md:h-8 md:w-10 object-contain transition-transform duration-200 group-hover:scale-[1.22]"
            />
            <div className="leading-none">
              <img
                src="/hopnote-text-logo.png"
                alt="Hopnote"
                className="h-6 w-auto object-contain mt-2"
              />
            </div>
          </Link>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="hidden sm:inline text-gray-700">{user.username}</span>
                <span
                  className={[
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    user.role === "teacher" ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700",
                  ].join(" ")}
                >
                  {user.role === "teacher" ? "Teacher" : "Student"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => { logout(); navigate("/"); }}>
                  <LogOut className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              </div>
            ) : isHome && (
              <Link to="/login/teacher" className="hidden sm:inline text-sm text-gray-700 hover:text-emerald-700">
                For teachers
              </Link>
            )}
            {isHome && !user && (
             <Button
             size="sm"
             onClick={() => navigate("/login/student")}
             className="group relative inline-flex items-center justify-center rounded-3xl px-5
                        bg-emerald-600 text-white font-normal hover:bg-emerald-600/95
                        transition-colors duration-200 focus:outline-none animate-slide-in-right"
           >
             <span
               className="buttonTicker select-none"
               data-label="Get Started"
             >
               <span className="line">Get Started</span>
             </span>
           </Button>
           
            )}
          </div>
        </div>
      </div>
      <div className="pointer-events-none h-px w-full bg-gradient-to-r from-transparent via-emerald-600/30 to-transparent" />
    </header>
  );
};

export default Header;
