import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth.jsx";
import App from "../App.jsx";
import { tokenStore } from "../api.js";
import { dashboardRoutes, fakeFetch, landlordUser, page, sampleSummary } from "./fakeFetch.js";

const health = { "GET /health": () => ({ body: { status: "ok", database: "up" } }) };

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => tokenStore.set(null));

describe("landing page", () => {
  it("explains the flow and the three roles to visitors", async () => {
    fakeFetch(health);
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Home repairs, sorted." })).toBeInTheDocument();
    const flow = screen.getByRole("heading", { name: "How a repair works" }).closest("section");
    expect(within(flow).getAllByRole("listitem")).toHaveLength(4);
    for (const role of ["landlord", "tenant", "worker"]) {
      expect(screen.getByRole("link", { name: `Join as a ${role}` })).toHaveAttribute("href", `/signup?role=${role}`);
    }
    const header = screen.getByRole("navigation", { name: "Account" });
    expect(within(header).getByRole("link", { name: "Create account" })).toBeInTheDocument();
  });

  it("'Join as a worker' opens sign-up with Worker chosen, and asks for the trade", async () => {
    fakeFetch(health);
    const user = userEvent.setup();
    renderApp("/");

    await user.click(await screen.findByRole("link", { name: "Join as a worker" }));
    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Worker/)).toBeChecked();
    expect(screen.getByLabelText("Your trade")).toBeInTheDocument();
  });

  it("an unknown ?role= just leaves the choice open", async () => {
    fakeFetch(health);
    renderApp("/signup?role=admin");
    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    for (const label of [/^Landlord/, /^Tenant/, /^Worker/]) expect(screen.getByLabelText(label)).not.toBeChecked();
  });

  it("public pages are indexable with a real title; private pages are marked noindex", async () => {
    fakeFetch(health);
    renderApp("/");
    await screen.findByRole("heading", { name: "Home repairs, sorted." });
    expect(document.title).toMatch(/^FixIt: home repairs, sorted/);
    expect(document.querySelector('meta[name="robots"]').content).toBe("index, follow");
  });

  it("a private page gets its own title and noindex", async () => {
    tokenStore.set("token");
    fakeFetch({
      ...health,
      "GET /auth/me": () => ({ body: { user: landlordUser } }),
      "GET /issues": () => ({ body: { items: [], page: { limit: 20, nextCursor: null, hasMore: false } } }),
      "GET /properties": () => ({ body: { items: [], page: { limit: 100, nextCursor: null, hasMore: false } } }),
    });
    renderApp("/issues");
    await screen.findByRole("heading", { name: "Issue inbox" });
    expect(document.title).toBe("Issues · FixIt");
    expect(document.querySelector('meta[name="robots"]').content).toBe("noindex, nofollow");
  });

  it("signed-in users get their dashboard at / instead", async () => {
    tokenStore.set("token");
    fakeFetch({
      ...health,
      "GET /auth/me": () => ({ body: { user: landlordUser } }),
      ...dashboardRoutes,
      "GET /issues/summary": () => ({ body: sampleSummary() }),
      "GET /issues": () => page([]),
      "GET /properties": () => page([]),
    });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Hi, Maria" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Home repairs, sorted." })).not.toBeInTheDocument();
  });
});
