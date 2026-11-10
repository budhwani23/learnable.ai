import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Ban, Clock, RefreshCw, XCircle } from "lucide-react";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

/**
 * Shown to signed-in accounts that can't use the app yet: on the waitlist (pending),
 * rejected or banned. Re-checks status in the background so approval lets them straight in.
 */
const Waitlist = () => {
  const { user, isAuthenticated, isApproved, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  // Poll every 30 s while waiting, so an approval shows up without a reload.
  useEffect(() => {
    if (user?.status !== "pending") return;
    const id = window.setInterval(() => { refreshUser(); }, 30_000);
    return () => window.clearInterval(id);
  }, [user?.status, refreshUser]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isApproved) return <Navigate to="/input" replace />;

  const status = user?.status;
  const copy = status === "banned"
    ? { icon: Ban, tone: "text-red-600 bg-red-50", title: "This account has been banned",
        body: "You can't use Hopnote with this account." }
    : status === "rejected"
      ? { icon: XCircle, tone: "text-amber-700 bg-amber-50", title: "Your request wasn't approved",
          body: "We couldn't approve this account for the launch." }
      : { icon: Clock, tone: "text-emerald-700 bg-emerald-50", title: "You're on the waitlist",
          body: "Thanks for signing up! We're letting people in gradually. An administrator will approve your account soon, and this page will open the app as soon as they do." };
  const Icon = copy.icon;

  const checkNow = async () => {
    setChecking(true);
    try { await refreshUser(); } finally { setChecking(false); }
  };

  return (
    <>
      <Header />
      <main className="bg-green-50 min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border text-center" data-testid="waitlist-screen">
          <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${copy.tone}`}>
            <Icon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">{copy.title}</h1>
          <p className="mt-3 text-gray-600">{copy.body}</p>
          {user?.status_reason && status !== "pending" && (
            <p className="mt-3 text-sm text-gray-500">Reason: {user.status_reason}</p>
          )}
          <p className="mt-4 text-sm text-gray-500">
            Signed in as <span className="font-medium text-gray-700">{user?.username}</span>
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            {status === "pending" && (
              <Button onClick={checkNow} disabled={checking} className="bg-emerald-600 hover:bg-emerald-700">
                <RefreshCw className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`} />
                Check my status
              </Button>
            )}
            <Button variant="outline" onClick={() => { logout(); navigate("/"); }}>Sign out</Button>
          </div>
          {status === "pending" && (
            <p className="mt-6 text-xs text-gray-400">
              Once you're in, you get 3 free credits for each kind of study material.
            </p>
          )}
        </div>
      </main>
    </>
  );
};

export default Waitlist;
