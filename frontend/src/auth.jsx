import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, setUnauthorizedHandler, tokenStore } from "./api.js";
import { Loading } from "./components/Status.jsx";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // "checking" while a stored token is being verified against /auth/me on page load.
  const [state, setState] = useState(() => ({ user: null, status: tokenStore.get() ? "checking" : "signed-out" }));

  const signOut = useCallback(() => {
    tokenStore.set(null);
    setState({ user: null, status: "signed-out" });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    if (state.status !== "checking") return;
    const controller = new AbortController();
    api
      .me({ signal: controller.signal })
      .then(({ user }) => setState({ user, status: "signed-in" }))
      .catch((err) => {
        if (err.name === "AbortError") return;
        // 401 = token expired/invalid -> signed out. Server unreachable -> also signed
        // out for now; the health banner explains why.
        signOut();
      });
    return () => controller.abort();
  }, [state.status, signOut]);

  const value = useMemo(() => {
    const accept = ({ token, user }) => {
      tokenStore.set(token);
      setState({ user, status: "signed-in" });
      return user;
    };
    return {
      user: state.user,
      status: state.status,
      signIn: async (email, password) => accept(await api.login({ email, password })),
      signUp: async (input) => accept(await api.register(input)),
      /** Save profile changes and update the signed-in user everywhere in the UI. */
      updateProfile: async (changes) => {
        const { user } = await api.updateMe(changes);
        setState({ user, status: "signed-in" });
        return user;
      },
      signOut,
    };
  }, [state, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Route guard: sends signed-out users to /login (and back afterwards); optional role. */
export function RequireAuth({ role, children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "checking") return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}
