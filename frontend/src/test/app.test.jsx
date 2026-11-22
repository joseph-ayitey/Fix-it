// End-to-end-ish UI tests: the real App, router and auth provider, with fetch faked.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth.jsx";
import App from "../App.jsx";
import { tokenStore } from "../api.js";
import { dashboardRoutes, fakeFetch, landlordUser, page, problem, sampleIssue, sampleProperty, sampleSummary, tenantUser } from "./fakeFetch.js";

const health = { "GET /health": () => ({ body: { status: "ok", database: "up", geocoding: "enabled" } }) };

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function signedInAs(user, routes = {}) {
  tokenStore.set("token");
  return fakeFetch({ ...health, ...dashboardRoutes, "GET /auth/me": () => ({ body: { user } }), ...routes });
}

beforeEach(() => tokenStore.set(null));

describe("signing in", () => {
  it("shows visitors the landing page at /, and 'Sign in' leads to the dashboard", async () => {
    fakeFetch({
      ...health,
      ...dashboardRoutes,
      "POST /auth/login": () => ({ body: { token: "t", user: landlordUser } }),
      "GET /issues/summary": () => ({ body: sampleSummary({ active: 1, urgent: 1, unacknowledged: 1, unassigned: 1 }) }),
      "GET /issues": () => page([sampleIssue()]),
      "GET /properties": () => page([{ ...sampleProperty, joinCode: "ABCD2345" }]),
    });
    const user = userEvent.setup();
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Home repairs, sorted." })).toBeInTheDocument();
    await user.click(screen.getAllByRole("link", { name: "Sign in" })[0]);
    expect(await screen.findByRole("heading", { name: "Sign in to FixIt" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "landlord@fixit.test");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Hi, Maria" })).toBeInTheDocument();
    expect(await screen.findByText("1 issue is waiting for a first response.")).toBeInTheDocument();
    expect(await screen.findByText(/No response from landlord for 2 days/)).toBeInTheDocument();
    expect(tokenStore.get()).toBe("t");
  });

  it("sends signed-out visitors of a protected page to sign in, then back to that page", async () => {
    fakeFetch({
      ...health,
      "POST /auth/login": () => ({ body: { token: "t", user: landlordUser } }),
      "GET /issues": () => page([sampleIssue()]),
      "GET /properties": () => page([]),
    });
    const user = userEvent.setup();
    renderApp("/issues");
    await user.type(await screen.findByLabelText("Email"), "landlord@fixit.test");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Issue inbox" })).toBeInTheDocument();
  });

  it("shows the server's message for a wrong password", async () => {
    fakeFetch({ ...health, "POST /auth/login": () => problem(401, "email or password is incorrect") });
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "x@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("email or password is incorrect");
  });
});

describe("tenant", () => {
  it("with no home yet is asked for a join code, and joining opens the property", async () => {
    let sentCode;
    signedInAs(tenantUser, {
      "GET /issues/summary": () => ({ body: sampleSummary() }),
      "GET /issues": () => page([]),
      "GET /properties": () => page([]),
      "POST /properties/join": (_u, init) => {
        sentCode = JSON.parse(init.body).code;
        return { status: 201, body: sampleProperty };
      },
      "GET /properties/10": () => ({ body: sampleProperty }),
    });
    const user = userEvent.setup();
    renderApp("/");

    await user.click(await screen.findByRole("link", { name: "Enter join code" }));
    await user.type(screen.getByLabelText("Join code"), "abcd-2345");
    await user.click(screen.getByRole("button", { name: "Link home" }));

    expect(await screen.findByText(/You're linked to this home/)).toBeInTheDocument();
    expect(sentCode).toBe("abcd-2345");
  });

  it("reports an issue with category and urgency", async () => {
    let sent;
    signedInAs(tenantUser, {
      "GET /properties": () => page([sampleProperty]),
      "POST /issues": (_u, init) => {
        sent = JSON.parse(init.body);
        return { status: 201, body: sampleIssue({ id: 101 }) };
      },
      "GET /issues/101": () => ({ body: sampleIssue({ id: 101 }) }),
    });
    const user = userEvent.setup();
    renderApp("/issues/new");

    await user.type(await screen.findByLabelText("What's wrong?"), "Water leaking under the kitchen sink");
    await user.selectOptions(screen.getByLabelText("Category"), "plumbing");
    await user.click(screen.getByLabelText(/Urgent/));
    await user.type(screen.getByLabelText("Details"), "Steady drip from the pipe.");
    await user.click(screen.getByRole("button", { name: "Send to landlord" }));

    expect(await screen.findByText(/Sent. Your landlord can see it now/)).toBeInTheDocument();
    expect(sent).toEqual({
      propertyId: 10,
      title: "Water leaking under the kitchen sink",
      category: "plumbing",
      urgency: "urgent",
      description: "Steady drip from the pipe.",
    });
  });

  it("can confirm a fix (the landlord already approved), or must give a reason to reopen", async () => {
    const resolved = sampleIssue({
      status: "resolved",
      acknowledgedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
      confirmations: { tenant: null, landlord: new Date().toISOString() },
      canConfirm: true,
      allowedTransitions: [{ to: "open", noteRequired: true }],
    });
    let patched;
    let confirmed;
    signedInAs(tenantUser, {
      "GET /issues/100": () => ({ body: resolved }),
      "PATCH /issues/100/status": (_u, init) => {
        patched = JSON.parse(init.body);
        return { body: { ...resolved, status: "open", canConfirm: false, allowedTransitions: [] } };
      },
      "POST /issues/100/confirm": (_u, init) => {
        confirmed = JSON.parse(init.body);
        return { body: { ...resolved, status: "closed", canConfirm: false, allowedTransitions: [], closedAt: new Date().toISOString() } };
      },
    });
    const user = userEvent.setup();
    renderApp("/issues/100");

    expect(await screen.findByText(/Please check and confirm, or reopen it/)).toBeInTheDocument();
    const panel = screen.getByRole("heading", { name: "Confirming the fix" }).closest(".panel");
    expect(within(panel).getByText(/Landlord approves the work/).className).toContain("check--done");
    expect(within(panel).getByText(/Tenant confirms it works/).className).not.toContain("check--done");

    // Reopening needs a reason.
    await user.click(screen.getByRole("button", { name: "Still not fixed: reopen" }));
    const submit = screen.getByRole("button", { name: "Still not fixed: reopen" });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Confirming closes it (the landlord had already approved).
    await user.type(within(panel).getByRole("textbox"), "All dry now");
    await user.click(within(panel).getByRole("button", { name: "Confirm it's fixed" }));
    expect(confirmed).toEqual({ note: "All dry now" });
    expect(await screen.findByText(/This issue is closed/)).toBeInTheDocument();
    expect(patched).toBeUndefined();
  });

  it("reopening sends the reason", async () => {
    const resolved = sampleIssue({
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      confirmations: { tenant: null, landlord: null },
      canConfirm: true,
      allowedTransitions: [{ to: "open", noteRequired: true }],
    });
    let patched;
    signedInAs(tenantUser, {
      "GET /issues/100": () => ({ body: resolved }),
      "PATCH /issues/100/status": (_u, init) => {
        patched = JSON.parse(init.body);
        return { body: { ...resolved, status: "open", canConfirm: false, allowedTransitions: [] } };
      },
    });
    const user = userEvent.setup();
    renderApp("/issues/100");
    await user.click(await screen.findByRole("button", { name: "Still not fixed: reopen" }));
    await user.type(screen.getByLabelText("Required: what's still wrong?"), "Still dripping");
    await user.click(screen.getByRole("button", { name: "Still not fixed: reopen" }));
    expect(patched).toEqual({ status: "open", note: "Still dripping" });
  });
});

describe("landlord", () => {
  it("sees the property's join code and its tenants", async () => {
    signedInAs(landlordUser, {
      "GET /properties/10": () => ({
        body: { ...sampleProperty, joinCode: "ABCD2345", tenants: [{ id: 2, name: "Anna Soler", email: "tenant@fixit.test", joinedAt: "2026-01-02T00:00:00.000Z" }] },
      }),
      "GET /issues": () => page([sampleIssue()]),
    });
    renderApp("/properties/10");
    expect(await screen.findByLabelText("Join code")).toHaveTextContent("ABCD-2345");
    expect(screen.getByText("Anna Soler", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Reported by Anna Soler/)).toBeInTheDocument();
  });

  it("only gets the status buttons the server allows, and can add a note", async () => {
    const open = sampleIssue({
      allowedTransitions: [
        { to: "in_progress", noteRequired: false },
        { to: "resolved", noteRequired: false },
      ],
    });
    let patched;
    signedInAs(landlordUser, {
      "GET /issues/100": () => ({ body: open }),
      "PATCH /issues/100/status": (_u, init) => {
        patched = JSON.parse(init.body);
        return { body: { ...open, status: "in_progress", acknowledgedAt: new Date().toISOString(), allowedTransitions: [{ to: "resolved", noteRequired: false }] } };
      },
    });
    const user = userEvent.setup();
    renderApp("/issues/100");

    const panel = (await screen.findByRole("heading", { name: "Update status" })).closest(".panel");
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual(["Start work", "Mark as fixed"]);

    await user.click(within(panel).getByRole("button", { name: "Start work" }));
    await user.type(within(panel).getByRole("textbox"), "Plumber booked for Thursday");
    await user.click(within(panel).getByRole("button", { name: "Start work" }));

    expect(patched).toEqual({ status: "in_progress", note: "Plumber booked for Thursday" });
    expect(await within(panel).findByRole("button", { name: "Mark as fixed" })).toBeInTheDocument();
  });

  it("can't open tenant-only pages", async () => {
    signedInAs(landlordUser, {
      "GET /issues/summary": () => ({ body: sampleSummary() }),
      "GET /issues": () => page([]),
      "GET /properties": () => page([]),
    });
    renderApp("/issues/new");
    expect(await screen.findByRole("heading", { name: "Hi, Maria" })).toBeInTheDocument();
  });
});
