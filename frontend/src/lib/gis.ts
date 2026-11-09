// Google Identity Services loader, shared by "Sign in with Google" and the Google Forms export.

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GIS_SRC = "https://accounts.google.com/gsi/client";

export interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: object) => void;
          renderButton: (el: HTMLElement, options: object) => void;
        };
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: { type: string; message?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

let gisPromise: Promise<void> | null = null;

export const loadGis = () => {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new Error("Could not load Google Sign-In"));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
};

const tokens = new Map<string, { token: string; expiresAt: number }>();

/**
 * Get an OAuth access token for `scope` via the GIS token popup.
 * Call from a click handler (after loadGis() has resolved) so the popup isn't blocked.
 */
export function requestAccessToken(scope: string): Promise<string> {
  const cached = tokens.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) return Promise.resolve(cached.token);
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error("Google isn't configured (VITE_GOOGLE_CLIENT_ID is missing)."));
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error("Google Sign-In hasn't loaded yet. Try again."));

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      callback: resp => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || "Google didn't grant access"));
          return;
        }
        tokens.set(scope, { token: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 });
        resolve(resp.access_token);
      },
      error_callback: err =>
        reject(new Error(err.type === "popup_closed" ? "Google sign-in was closed" : err.message || err.type)),
    });
    client.requestAccessToken();
  });
}
