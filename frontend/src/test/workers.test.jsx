import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth.jsx";
import App from "../App.jsx";
import { tokenStore } from "../api.js";
import { fakeFetch, landlordUser, sampleIssue } from "./fakeFetch.js";

const workerUser = { id: 3, email: "worker@fixit.test", name: "Marc Ribas", role: "worker", trade: "plumber", area: "Barcelona", createdAt: "2026-01-01T00:00:00.000Z" };
const marcInDirectory = { id: 3, name: "Marc R.", trade: "plumber", tradeLabel: "Plumber", area: "Barcelona", worksForYou: false, completedJobs: 4, activeJobs: 1, inArea: true };

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function signedInAs(user, routes) {
  tokenStore.set("token");
  return fakeFetch({
    "GET /health": () => ({ body: { status: "ok", database: "up" } }),
    "GET /auth/me": () => ({ body: { user } }),
    ...routes,
  });
}

const emptySummary = { active: 0, urgent: 0, unacknowledged: 0, unassigned: 0, awaitingConfirmation: 0, needsYourConfirmation: 0 };

beforeEach(() => tokenStore.set(null));

describe("workers", () => {
  it("sign up with a trade, and get the worker navigation", async () => {
    let sent;
    fakeFetch({
      "GET /health": () => ({ body: { status: "ok", database: "up" } }),
      "POST /auth/register": (_u, init) => {
        sent = JSON.parse(init.body);
        return { status: 201, body: { token: "t", user: workerUser } };
      },
      "GET /issues/summary": () => ({ body: { ...emptySummary, pendingOffers: 0 } }),
      "GET /issues": () => ({ body: [] }),
      "GET /properties": () => ({ body: [] }),
      "GET /offers": () => ({ body: [] }),
    });
    const user = userEvent.setup();
    renderApp("/signup");

    await user.click(await screen.findByLabelText(/^Worker/));
    await user.selectOptions(screen.getByLabelText("Your trade"), "plumber");
    await user.type(screen.getByLabelText("Where you work (optional)"), "Barcelona");
    await user.type(screen.getByLabelText("Full name"), "Marc Ribas");
    await user.type(screen.getByLabelText("Email"), "worker@fixit.test");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/No job offers waiting/)).toBeInTheDocument();
    expect(sent).toMatchObject({ role: "worker", trade: "plumber", area: "Barcelona" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Jobs" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Properties|My home/ })).not.toBeInTheDocument();
  });

  it("tenants and landlords don't get asked for a trade", async () => {
    fakeFetch({ "GET /health": () => ({ body: { status: "ok", database: "up" } }) });
    const user = userEvent.setup();
    renderApp("/signup");
    await user.click(await screen.findByLabelText(/^Tenant/));
    expect(screen.queryByLabelText("Your trade")).not.toBeInTheDocument();
  });

  it("a landlord finds a worker by the suggested trade and sends a job offer", async () => {
    const issue = sampleIssue({ category: "plumbing", offers: [], allowedTransitions: [{ to: "in_progress", noteRequired: false }] });
    let searched;
    let offered;
    signedInAs(landlordUser, {
      "GET /issues/100": () => ({ body: issue }),
      "GET /team/directory": (url) => {
        searched = Object.fromEntries(url.searchParams);
        return { body: [marcInDirectory] };
      },
      "POST /offers": (_u, init) => {
        offered = JSON.parse(init.body);
        return {
          status: 201,
          body: { ...issue, offers: [{ id: 9, status: "pending", worker: { id: 3, name: "Marc Ribas", tradeLabel: "Plumber" }, message: offered.message }] },
        };
      },
    });
    const user = userEvent.setup();
    renderApp("/issues/100");

    const panel = (await screen.findByRole("heading", { name: "Find a worker" })).closest(".panel");
    expect(within(panel).getByRole("combobox")).toHaveValue("plumber"); // suggested from "plumbing"
    await user.click(await within(panel).findByRole("radio", { name: /Marc R\./ }));
    expect(searched).toEqual({ trade: "plumber", city: "Barcelona" });
    await user.type(within(panel).getByRole("textbox"), "Tenant home after 5");
    await user.click(within(panel).getByRole("button", { name: "Send job offer" }));

    expect(offered).toEqual({ issueId: 100, workerId: 3, message: "Tenant home after 5" });
    expect(await screen.findByText(/waiting for their answer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
  });

  it("a worker sees the offer on their dashboard and accepts it", async () => {
    let accepted = false;
    signedInAs(workerUser, {
      "GET /issues/summary": () => ({ body: { ...emptySummary, pendingOffers: 1 } }),
      "GET /issues": () => ({ body: [] }),
      "GET /properties": () => ({ body: [] }),
      "GET /offers": () => ({
        body: [
          {
            id: 9,
            status: "pending",
            message: "Tenant home after 5",
            createdAt: new Date().toISOString(),
            landlord: { id: 1, name: "Maria Garcia" },
            issue: { id: 100, title: "Water leaking under the kitchen sink", category: "plumbing", urgency: "urgent", description: "Steady drip.", city: "Barcelona", photoCount: 2 },
          },
        ],
      }),
      "POST /offers/9/accept": () => {
        accepted = true;
        return { body: sampleIssue({ assignee: { id: 3, name: "Marc Ribas", tradeLabel: "Plumber" } }) };
      },
      "GET /issues/100": () => ({ body: sampleIssue({ assignee: { id: 3, name: "Marc Ribas", tradeLabel: "Plumber" } }) }),
    });
    const user = userEvent.setup();
    renderApp("/");

    const offers = await screen.findByRole("list", { name: "Job offers" });
    expect(within(offers).getByText("Water leaking under the kitchen sink")).toBeInTheDocument();
    expect(within(offers).getByText("Tenant home after 5")).toBeInTheDocument();
    expect(screen.getByText("You have 1 job offer to answer.")).toBeInTheDocument();

    await user.click(within(offers).getByRole("button", { name: "Accept job" }));
    expect(accepted).toBe(true);
    expect(await screen.findByText(/Job accepted/)).toBeInTheDocument();
  });

  it("after marking it fixed, the worker waits for both confirmations and has no confirm button", async () => {
    const issue = sampleIssue({
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      assignee: { id: 3, name: "Marc Ribas", tradeLabel: "Plumber" },
      confirmations: { tenant: new Date().toISOString(), landlord: null },
      canConfirm: false,
      allowedTransitions: [],
    });
    signedInAs(workerUser, { "GET /issues/100": () => ({ body: issue }) });
    renderApp("/issues/100");

    const panel = (await screen.findByRole("heading", { name: "Confirming the fix" })).closest(".panel");
    expect(within(panel).getByText(/Waiting for the landlord/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button")).not.toBeInTheDocument();
  });

  it("landlord and worker can post a private note; the tenant gets no such option", async () => {
    const issue = sampleIssue({ status: "in_progress", assignee: { id: 3, name: "Marc Ribas", tradeLabel: "Plumber" }, allowedTransitions: [] });
    let sent;
    signedInAs(workerUser, {
      "GET /issues/100": () => ({ body: issue }),
      "POST /issues/100/comments": (_u, init) => {
        sent = JSON.parse(init.body);
        return { status: 201, body: issue };
      },
    });
    const user = userEvent.setup();
    renderApp("/issues/100");

    await user.click(await screen.findByLabelText(/Private: landlord/));
    await user.type(screen.getByLabelText("Add a comment"), "Quote: 120 EUR");
    await user.click(screen.getByRole("button", { name: "Post private note" }));
    expect(sent).toEqual({ body: "Quote: 120 EUR", visibility: "internal" });
  });

  it("each tab keeps its own sign-in (sessionStorage), so tabs can't swap identities", () => {
    tokenStore.set("landlord-token");
    expect(sessionStorage.getItem("fixit.token")).toBe("landlord-token");
    expect(localStorage.getItem("fixit.token")).toBeNull();
  });
});
