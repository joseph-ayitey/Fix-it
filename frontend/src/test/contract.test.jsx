// Behaviour that comes from the v2 contract: cursor pagination, filters in the URL,
// Problem Details shown next to form fields, Idempotency-Key on reports, loading /
// empty / error states with "Try again", and the dashboard's stats and live feed.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth.jsx";
import App from "../App.jsx";
import ActivityFeed from "../components/ActivityFeed.jsx";
import { tokenStore } from "../api.js";
import {
  dashboardRoutes,
  fakeFetch,
  landlordUser,
  page,
  problem,
  sampleActivity,
  sampleIssue,
  sampleProperty,
  sampleStats,
  sampleSummary,
  tenantUser,
} from "./fakeFetch.js";

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
    "GET /health": () => ({ body: { status: "ok", database: "up", geocoding: "enabled" } }),
    "GET /auth/me": () => ({ body: { user } }),
    ...routes,
  });
}

/** The query string of every call to `path`, as objects. */
const callsTo = (fetchMock, path, method = "GET") =>
  fetchMock.mock.calls
    .filter(([url, init]) => new URL(url, "http://x").pathname === `/api${path}` && (init?.method ?? "GET") === method)
    .map(([url, init]) => ({ query: Object.fromEntries(new URL(url, "http://x").searchParams), init }));

beforeEach(() => tokenStore.set(null));

describe("pagination", () => {
  it("the inbox loads the next page with page.nextCursor when 'Load more' is pressed", async () => {
    const fetchMock = signedInAs(landlordUser, {
      "GET /properties": () => page([sampleProperty]),
      "GET /issues": (url) =>
        url.searchParams.get("cursor") === "cursor-2"
          ? page([sampleIssue({ id: 102, title: "Front door lock sticks" })])
          : page([sampleIssue({ id: 101, title: "Boiler makes a banging noise" })], { nextCursor: "cursor-2" }),
    });
    const user = userEvent.setup();
    renderApp("/issues");

    expect(await screen.findByText("Boiler makes a banging noise")).toBeInTheDocument();
    expect(screen.queryByText("Front door lock sticks")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more issues" }));

    expect(await screen.findByText("Front door lock sticks")).toBeInTheDocument();
    expect(screen.getByText("Boiler makes a banging noise")).toBeInTheDocument(); // appended, not replaced
    expect(screen.queryByRole("button", { name: "Load more issues" })).not.toBeInTheDocument();
    expect(screen.getByText("That's all 2 issues.")).toBeInTheDocument();
    const queries = callsTo(fetchMock, "/issues").map((c) => c.query);
    expect(queries[0]).toEqual({ status: "active", limit: "20" });
    expect(queries.at(-1)).toEqual({ status: "active", limit: "20", cursor: "cursor-2" });
  });

  it("the properties list has 'Load more' too", async () => {
    signedInAs(landlordUser, {
      "GET /properties": (url) =>
        url.searchParams.get("cursor")
          ? page([{ ...sampleProperty, id: 11, label: "Gràcia studio" }])
          : page([sampleProperty], { nextCursor: "p2" }),
    });
    const user = userEvent.setup();
    renderApp("/properties");

    await user.click(await screen.findByRole("button", { name: "Load more properties" }));
    expect(await screen.findByRole("heading", { name: "Gràcia studio" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Eixample flat" })).toBeInTheDocument();
  });

  it("search, urgency, category and sort go to the API and stay in the URL", async () => {
    const fetchMock = signedInAs(landlordUser, {
      "GET /properties": () => page([sampleProperty]),
      "GET /issues": () => page([sampleIssue()]),
    });
    const user = userEvent.setup();
    renderApp("/issues?urgency=urgent");

    expect(await screen.findByLabelText("Urgency")).toHaveValue("urgent");
    await user.selectOptions(screen.getByLabelText("Category"), "plumbing");
    await user.selectOptions(screen.getByLabelText("Sort"), "newest");
    await user.type(screen.getByRole("searchbox", { name: "Search issues" }), "leak{Enter}");

    await waitFor(() =>
      expect(callsTo(fetchMock, "/issues").at(-1).query).toEqual({
        status: "active",
        urgency: "urgent",
        category: "plumbing",
        sort: "newest",
        q: "leak",
        limit: "20",
      }),
    );
    // "Clear filters" resets them all (the sort is kept: it isn't a filter).
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await waitFor(() => expect(callsTo(fetchMock, "/issues").at(-1).query).toEqual({ status: "active", sort: "newest", limit: "20" }));
    expect(screen.getByRole("searchbox", { name: "Search issues" })).toHaveValue("");
  });
});

describe("the report form", () => {
  async function fillIn(user, { title = "Water leaking under the kitchen sink", details = "Steady drip from the pipe." } = {}) {
    if (title) await user.type(await screen.findByLabelText("What's wrong?"), title);
    await user.selectOptions(screen.getByLabelText("Category"), "plumbing");
    if (details) await user.type(screen.getByLabelText("Details"), details);
  }

  it("leaves validation to the API and shows its field errors next to each field", async () => {
    let sent;
    signedInAs(tenantUser, {
      "GET /properties": () => page([sampleProperty]),
      "POST /issues": (_u, init) => {
        sent = JSON.parse(init.body);
        return problem(400, "title: must NOT have fewer than 3 characters; description: must NOT have fewer than 10 characters", {
          errors: [
            { field: "title", message: "must NOT have fewer than 3 characters" },
            { field: "description", message: "must NOT have fewer than 10 characters" },
          ],
        });
      },
    });
    const user = userEvent.setup();
    renderApp("/issues/new");

    await user.type(await screen.findByLabelText("What's wrong?"), "Ow");
    await user.type(screen.getByLabelText("Details"), "Leaks");
    await user.click(screen.getByRole("button", { name: "Send to landlord" }));

    // The browser didn't block it (noValidate): the API got the short values.
    expect(sent).toEqual({ propertyId: 10, title: "Ow", description: "Leaks", urgency: "normal" });

    const title = screen.getByLabelText("What's wrong?");
    await waitFor(() => expect(title).toHaveFocus()); // the first invalid field
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription(/must NOT have fewer than 3 characters/);
    expect(screen.getByLabelText("Details")).toHaveAccessibleDescription(/must NOT have fewer than 10 characters/);
    expect(screen.getByLabelText("Category")).not.toHaveAttribute("aria-invalid");

    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("Please check the form.");
    expect(summary).toHaveTextContent("title: must NOT have fewer than 3 characters; description");
    expect(within(summary).getByRole("link", { name: "Details" })).toBeInTheDocument();
  });

  it("sends an Idempotency-Key and reuses it when retrying after a 503", async () => {
    const keys = [];
    signedInAs(tenantUser, {
      "GET /properties": () => page([sampleProperty]),
      "POST /issues": (_u, init) => {
        keys.push(init.headers["Idempotency-Key"]);
        return keys.length === 1 ? problem(503, "The database is restarting") : { status: 201, body: sampleIssue({ id: 101 }) };
      },
      "GET /issues/101": () => ({ body: sampleIssue({ id: 101 }) }),
    });
    const user = userEvent.setup();
    renderApp("/issues/new");

    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Send to landlord" }));
    expect(await screen.findByText(/safe to press Send again/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The database is restarting");

    await user.click(screen.getByRole("button", { name: "Send again" }));
    expect(await screen.findByText(/Sent. Your landlord can see it now/)).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{32,36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps the key after a network failure, but uses a new one once a 400 has been fixed", async () => {
    const keys = [];
    let attempt = 0;
    signedInAs(tenantUser, {
      "GET /properties": () => page([sampleProperty]),
      "POST /issues": (_u, init) => {
        attempt += 1;
        keys.push(init.headers["Idempotency-Key"]);
        if (attempt === 1) throw new TypeError("Failed to fetch"); // the request never got an answer
        if (attempt === 2) return problem(400, "title: must NOT have fewer than 3 characters", { errors: [{ field: "title", message: "must NOT have fewer than 3 characters" }] });
        return { status: 201, body: sampleIssue({ id: 101 }) };
      },
      "GET /issues/101": () => ({ body: sampleIssue({ id: 101 }) }),
    });
    const user = userEvent.setup();
    renderApp("/issues/new");

    await fillIn(user, { title: "Ow" });
    await user.click(screen.getByRole("button", { name: "Send to landlord" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Can't reach the FixIt server/);
    await user.click(screen.getByRole("button", { name: "Send again" }));
    expect(await screen.findByText("must NOT have fewer than 3 characters", { selector: ".field__error" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("What's wrong?"), "ch, the tap is broken");
    await user.click(screen.getByRole("button", { name: "Send to landlord" }));
    await screen.findByText(/Sent. Your landlord can see it now/);
    expect(keys[1]).toBe(keys[0]); // retry after the network failure: same key
    expect(keys[2]).not.toBe(keys[1]); // corrected report: new key
  });

  it("tells the user when the server had already received the report", async () => {
    signedInAs(tenantUser, {
      "GET /properties": () => page([sampleProperty]),
      "POST /issues": () => ({ status: 201, body: sampleIssue({ id: 101 }), headers: { "Idempotent-Replayed": "true" } }),
      "GET /issues/101": () => ({ body: sampleIssue({ id: 101 }) }),
    });
    const user = userEvent.setup();
    renderApp("/issues/new");

    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Send to landlord" }));
    expect(await screen.findByText(/We'd already received this report/)).toBeInTheDocument();
    expect(screen.queryByText(/Sent. Your landlord can see it now/)).not.toBeInTheDocument();
  });

  it("sign-up shows the API's field errors too", async () => {
    fakeFetch({
      "GET /health": () => ({ body: { status: "ok", database: "up", geocoding: "enabled" } }),
      "POST /auth/register": () =>
        problem(400, 'email: must match format "email"', { errors: [{ field: "email", message: 'must match format "email"' }] }),
    });
    const user = userEvent.setup();
    renderApp("/signup");

    await user.click(await screen.findByLabelText(/^Tenant/));
    await user.type(screen.getByLabelText("Full name"), "Anna");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const email = screen.getByLabelText("Email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAccessibleDescription('must match format "email"');
  });
});

describe("loading, empty and error states", () => {
  it("an empty inbox says what to do next", async () => {
    signedInAs(tenantUser, {
      "GET /properties": () => page([sampleProperty]),
      "GET /issues": () => page([]),
    });
    renderApp("/issues");
    expect(await screen.findByText("No active issues.")).toBeInTheDocument();
    expect(screen.getByText(/report it and follow it here/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Report an issue" }).length).toBeGreaterThan(0);
  });

  it("shows a skeleton, then the problem's message with a 'Try again' that re-fetches", async () => {
    let calls = 0;
    signedInAs(landlordUser, {
      "GET /properties": () => page([sampleProperty]),
      "GET /issues": () => {
        calls += 1;
        return calls === 1 ? problem(500, "The database didn't answer in time") : page([sampleIssue({ title: "Boiler makes a banging noise" })]);
      },
    });
    const user = userEvent.setup();
    renderApp("/issues");

    expect(await screen.findByText("Loading issues…")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load issues. The database didn't answer in time");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Boiler makes a banging noise")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("a malformed issue id (400 for path.issueId) reads as 'not found'", async () => {
    signedInAs(landlordUser, {
      "GET /issues/abc": () => problem(400, "path.issueId: must be integer", { errors: [{ field: "path.issueId", message: "must be integer" }] }),
    });
    renderApp("/issues/abc");
    expect(await screen.findByRole("alert")).toHaveTextContent("Issue not found");
  });

  it("the landlord's team reads workers from GET /team/workers and shows an empty state", async () => {
    signedInAs(landlordUser, {
      "GET /team/workers": () => page([]),
      "GET /team/directory": () => page([], { limit: 50 }),
    });
    renderApp("/team");
    expect(await screen.findByText("No workers yet.")).toBeInTheDocument();
    expect(await screen.findByText("No workers have signed up yet.")).toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("shows tiles, the map, response times (with null medians), categories, the trend and activity", async () => {
    const stats = sampleStats({
      responseTimes: { windowDays: 90, medianHoursToFirstResponse: null, medianHoursToClose: 72, respondedCount: 0, closedCount: 3 },
    });
    signedInAs(landlordUser, {
      "GET /issues/summary": () => ({ body: sampleSummary({ active: 3, urgent: 1, unacknowledged: 1 }) }),
      "GET /properties": () => page([sampleProperty, { ...sampleProperty, id: 11, label: "Gràcia studio", openIssueCount: 0, urgentIssueCount: 0 }]),
      "GET /issues": () => page([sampleIssue()]),
      "GET /dashboard/stats": () => ({ body: stats }),
      "GET /dashboard/activity": () => page([sampleActivity({ actor: { id: 2, name: "Anna Soler", role: "tenant" } })]),
    });
    renderApp("/");

    expect(await screen.findByText("1 issue is waiting for a first response.")).toBeInTheDocument();
    expect(screen.getByText("Active issues").closest("a")).toHaveTextContent("3");
    expect(screen.getByTestId("map")).toHaveTextContent("2 on map");
    const cards = screen.getByRole("list", { name: "Your properties" });
    expect(within(cards).getByText("Urgent issues open")).toBeInTheDocument();
    expect(within(cards).getByText("All clear")).toBeInTheDocument();

    const times = (await screen.findByRole("heading", { name: "Response times" })).closest("section");
    expect(within(times).getByText("Not enough data yet")).toBeInTheDocument();
    expect(within(times).getByText("3 days")).toBeInTheDocument();
    expect(within(times).getByText("median of 3 issues")).toBeInTheDocument();

    const categories = screen.getByRole("list", { name: "Issues by category" });
    expect(within(categories).getAllByRole("link")).toHaveLength(2); // only categories with issues
    expect(within(categories).getByRole("link", { name: /Plumbing \/ leaks/ })).toHaveAttribute("href", "/issues?status=&category=plumbing");
    expect(screen.getByText("6 other categories have no issues.")).toBeInTheDocument();

    const trend = screen.getByRole("heading", { name: "Last 12 weeks" }).closest("section");
    expect(within(trend).getAllByRole("row")).toHaveLength(13); // header + 12 weeks

    const feed = await screen.findByRole("list", { name: "Recent activity" });
    const event = within(feed).getByRole("link");
    expect(event).toHaveTextContent("Anna Soler commented");
    expect(event).toHaveTextContent("A plumber is coming on Thursday morning.");
    expect(event).toHaveAttribute("href", "/issues/100");
  });

  it("a stats failure only affects its own panels, with 'Try again'", async () => {
    let statsCalls = 0;
    signedInAs(landlordUser, {
      ...dashboardRoutes,
      "GET /issues/summary": () => ({ body: sampleSummary() }),
      "GET /properties": () => page([sampleProperty]),
      "GET /issues": () => page([]),
      "GET /dashboard/stats": () => {
        statsCalls += 1;
        return statsCalls === 1 ? problem(500, "Statistics are unavailable") : { body: sampleStats() };
      },
    });
    const user = userEvent.setup();
    renderApp("/");

    const alert = await screen.findByText(/Statistics are unavailable/);
    expect(screen.getByText("No active issues across your properties.")).toBeInTheDocument();
    await user.click(within(alert.closest("[role=alert]")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Response times" })).toBeInTheDocument();
  });
});

describe("live activity feed", () => {
  function renderFeed(props) {
    return render(
      <MemoryRouter>
        <ActivityFeed viewerId={1} {...props} />
      </MemoryRouter>,
    );
  }

  it("polls for new events, adds them at the top, and stops when paused", async () => {
    let calls = 0;
    const older = sampleActivity({ id: 1, excerpt: "First comment" });
    const newer = sampleActivity({ id: 2, type: "status_change", toStatus: "in_progress", excerpt: null, actor: { id: 3, name: "Marc Ribas", role: "worker" } });
    const fetchMock = fakeFetch({
      "GET /dashboard/activity": () => {
        calls += 1;
        return page(calls === 1 ? [older] : [newer, older]);
      },
    });
    const user = userEvent.setup();
    renderFeed({ intervalMs: 50 });

    const list = await screen.findByRole("list", { name: "Recent activity" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Marc Ribas moved it to In progress");
    expect(first.className).toContain("feed__item--new");
    expect(second).toHaveTextContent("You commented");
    expect(second.className).not.toContain("feed__item--new");
    expect(callsTo(fetchMock, "/dashboard/activity")[0].query).toEqual({ limit: "15" });

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Paused")).toBeInTheDocument();
    const before = calls;
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(before);
  });

  it("shows an error with 'Try again' when the first load fails", async () => {
    let calls = 0;
    fakeFetch({
      "GET /dashboard/activity": () => {
        calls += 1;
        return calls === 1 ? problem(500, "Activity is unavailable") : page([]);
      },
    });
    const user = userEvent.setup();
    renderFeed({ intervalMs: 60_000 });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Activity is unavailable");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
  });
});
