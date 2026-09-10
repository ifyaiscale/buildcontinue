let pendingChallenge: Promise<string | null> | null = null;

export function isEmbeddedWorkspace() {
  return typeof window !== "undefined" && window.top !== window.self;
}

function challenge() {
  if (!pendingChallenge) {
    pendingChallenge = fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin", redirect: "error" })
      .then(async response => {
        if (!response.ok) throw new Error("Could not prepare secure access. Open the standalone workspace and refresh.");
        const data = await response.json();
        if (data.token !== null && typeof data.token !== "string") throw new Error("Invalid security response. Refresh the workspace.");
        return data.token as string | null;
      }).finally(() => { pendingChallenge = null; });
  }
  return pendingChallenge;
}

export async function dashboardFetch(path: string, options: RequestInit = {}) {
  if (!path.startsWith("/api/") || path.startsWith("//")) throw new Error("Use a workspace API path.");
  if (path === "/api/auth/login" && isEmbeddedWorkspace()) throw new Error("Open secure sign-in in its own tab. Embedded previews can block security cookies.");
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes((options.method || "GET").toUpperCase())) {
    // Fetch again after login/logout so the token follows the current session.
    const token = await challenge();
    if (token) {
      headers.set("X-Limitless-CSRF", token);
      headers.set("X-Limitless-Origin", window.location.origin);
    }
  }
  return fetch(path, { ...options, headers, credentials: "same-origin", redirect: "error" });
}
