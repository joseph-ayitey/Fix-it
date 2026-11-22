import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api.js";
import { RequireAuth, useAuth } from "./auth.jsx";
import { useApi } from "./useApi.js";
import { LoginPage, SignupPage } from "./pages/AuthPages.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import PropertiesPage, { AddPropertyPage, JoinPropertyPage } from "./pages/PropertiesPage.jsx";
import PropertyDetailPage from "./pages/PropertyDetailPage.jsx";
import IssuesPage from "./pages/IssuesPage.jsx";
import NewIssuePage from "./pages/NewIssuePage.jsx";
import IssueDetailPage from "./pages/IssueDetailPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import { Loading } from "./components/Status.jsx";
import TeamPage from "./pages/TeamPage.jsx";

function HealthBanner() {
  const { error, data } = useApi((signal) => api.health({ signal }), []);
  if (!error && data?.status !== "degraded") return null;
  return (
    <div className="banner banner--error banner--top" role="alert">
      {error && error.status !== 503
        ? "Can't reach the FixIt server. Start it with `npm run dev` in backend/."
        : "The server is running but can't reach PostgreSQL. Start it with `docker compose up -d db` in backend/."}
    </div>
  );
}

function Header() {
  const { user, signOut } = useAuth();
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <NavLink to="/" className="brand">
          FiX-iT
        </NavLink>
        {!user && (
          <nav className="nav" aria-label="Account">
            <NavLink to="/login">Sign in</NavLink>
            <NavLink to="/signup" className="button button--small">
              Create account
            </NavLink>
          </nav>
        )}
        {user && (
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/issues">{user.role === "worker" ? "Jobs" : "Issues"}</NavLink>
            {user.role !== "worker" && <NavLink to="/properties">{user.role === "landlord" ? "Properties" : "My home"}</NavLink>}
            {user.role !== "tenant" && <NavLink to="/team">{user.role === "landlord" ? "Team" : "Landlords"}</NavLink>}
            <span className="nav__user" title={user.email}>
              {user.name} <span className="badge">{user.role}</span>
            </span>
            <button type="button" className="button--ghost button--small" onClick={signOut}>
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}

const authed = (element, role) => <RequireAuth role={role}>{element}</RequireAuth>;

/** "/" is the landing page for visitors and the dashboard once you're signed in. */
function Home() {
  const { user, status } = useAuth();
  if (status === "checking") return <Loading />;
  return user ? <DashboardPage /> : <LandingPage />;
}

export default function App() {
  return (
    <>
      <Header />
      <HealthBanner />
      <main className="container">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/" element={<Home />} />
          <Route path="/properties" element={authed(<PropertiesPage />)} />
          <Route path="/properties/new" element={authed(<AddPropertyPage />, "landlord")} />
          <Route path="/properties/:id" element={authed(<PropertyDetailPage />)} />
          <Route path="/join" element={authed(<JoinPropertyPage />, "tenant")} />
          <Route path="/issues" element={authed(<IssuesPage />)} />
          <Route path="/issues/new" element={authed(<NewIssuePage />, "tenant")} />
          <Route path="/issues/:id" element={authed(<IssueDetailPage />)} />
          <Route path="/team" element={authed(<TeamPage />)} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </>
  );
}
