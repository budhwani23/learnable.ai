// import "./ticker.css";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Coins, LogOut, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RESOURCE_TYPES } from "@/lib/types";

/**
 * Sticky site header with the brand logo. Signed-in users see an Admin link (admins only), a credits
 * popover with remaining credits per resource type (approved users), their role badge and Sign out;
 * signed-out visitors on the home page see the teacher link and Get Started.
 */
const Header = () => {
  const { pathname } = useLocation();
  const { user, logout, isApproved, isAdmin } = useAuth();
  const totalLeft = user ? RESOURCE_TYPES.reduce((n, t) => n + (user.credits?.[t.id]?.remaining ?? 0), 0) : 0;
  const navigate = useNavigate();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    /** Mark the header as scrolled (adds shadow/border) once the page is scrolled past 6px. */
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
                {isAdmin && (
                  <Button asChild size="sm" variant="ghost" className={pathname === "/admin" ? "text-emerald-700" : ""}>
                    <Link to="/admin" data-testid="admin-link">
                      <Shield className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Admin</span>
                    </Link>
                  </Button>
                )}
                {isApproved && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="rounded-full h-8 gap-1.5" data-testid="credits-button"
                              aria-label={`${totalLeft} credits left`}>
                        <Coins className="h-4 w-4 text-amber-500" />
                        <span>{totalLeft}</span>
                        <span className="hidden md:inline text-gray-500">credits</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72">
                      <p className="text-sm font-medium text-gray-900">Your credits</p>
                      <p className="text-xs text-gray-500 mb-3">Each generation uses 1 credit of its type. Failed generations are refunded.</p>
                      <ul className="space-y-1.5" data-testid="credits-list">
                        {RESOURCE_TYPES.map((t) => {
                          const c = user.credits?.[t.id];
                          const left = c?.remaining ?? 0;
                          return (
                            <li key={t.id} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700">{t.label}</span>
                              <span className={left === 0 ? "text-red-600 font-medium" : "text-gray-900 font-medium"}>
                                {left} / {c?.limit ?? 0}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-3 text-xs text-gray-500">Need more? Ask an administrator to top up your credits.</p>
                    </PopoverContent>
                  </Popover>
                )}
                <span className="hidden sm:inline text-gray-700">{user.username}</span>
                <span
                  className={[
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    user.is_admin ? "bg-slate-800 text-white"
                      : user.role === "teacher" ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700",
                  ].join(" ")}
                >
                  {user.is_admin ? "Admin" : user.role === "teacher" ? "Teacher" : "Student"}
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
