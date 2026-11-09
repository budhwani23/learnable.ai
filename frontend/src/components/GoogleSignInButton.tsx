import { useEffect, useRef, useState } from "react";
import { googleLogin } from "@/lib/library";
import { GOOGLE_CLIENT_ID as CLIENT_ID, loadGis } from "@/lib/gis";

/** "Sign in with Google" (Google Identity Services). Hidden when no client id is configured. */
export default function GoogleSignInButton({ onSignedIn }: { onSignedIn: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }: { credential: string }) => {
            try {
              await googleLogin(credential);
              onSignedIn();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Google sign-in failed");
            }
          },
        });
        window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", width: 280 });
      })
      .catch(e => setError(e.message));
    return () => { cancelled = true; };
  }, [onSignedIn]);

  if (!CLIENT_ID) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={ref} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
