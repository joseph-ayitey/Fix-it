import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth.jsx";
import App from "../App.jsx";
import { tokenStore } from "../api.js";
import { fakeFetch, landlordUser, sampleIssue, sampleProperty, tenantUser } from "./fakeFetch.js";

const png = (name = "leak.png", size = 100) => new File([new Uint8Array(size)], name, { type: "image/png" });

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

beforeEach(() => tokenStore.set(null));

describe("photo uploads", () => {
  it("a report with photos is sent as multipart with the files under 'photos'", async () => {
    let sent;
    signedInAs(tenantUser, {
      "GET /properties": () => ({ body: [sampleProperty] }),
      "POST /issues": (_u, init) => {
        sent = init;
        return { status: 201, body: sampleIssue({ id: 101 }) };
      },
      "GET /issues/101": () => ({ body: sampleIssue({ id: 101 }) }),
    });
    const user = userEvent.setup();
    renderApp("/issues/new");

    await user.type(await screen.findByLabelText("What's wrong?"), "Mould on the ceiling");
    await user.selectOptions(screen.getByLabelText("Category"), "pest");
    await user.type(screen.getByLabelText("Details"), "Spreading above the shower.");
    await user.upload(screen.getByLabelText("📷 Add photos"), [png("ceiling.png"), png("closeup.png")]);

    expect(screen.getByRole("list", { name: "Selected photos" }).children).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Remove closeup.png" }));
    await user.click(screen.getByRole("button", { name: "Send to landlord" }));

    await screen.findByText(/Sent. Your landlord can see it now/);
    expect(sent.body).toBeInstanceOf(FormData);
    expect(sent.headers["Content-Type"]).toBeUndefined(); // the browser adds the multipart boundary
    expect(sent.body.getAll("photos").map((f) => f.name)).toEqual(["ceiling.png"]);
    expect(sent.body.get("title")).toBe("Mould on the ceiling");
    expect(sent.body.get("propertyId")).toBe("10");
  });

  it("refuses non-images and oversized files before uploading", async () => {
    signedInAs(tenantUser, { "GET /properties": () => ({ body: [sampleProperty] }) });
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/issues/new");

    const input = await screen.findByLabelText("📷 Add photos");
    await user.upload(input, [new File(["%PDF"], "lease.pdf", { type: "application/pdf" }), png("huge.png", 9 * 1024 * 1024)]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("lease.pdf: only JPEG, PNG, WebP or GIF");
    expect(alert).toHaveTextContent("huge.png: larger than 8 MB");
    expect(screen.queryByRole("list", { name: "Selected photos" })).not.toBeInTheDocument();
  });

  it("shows the report's photos (loaded with the sign-in token) and allows a photo-only comment", async () => {
    const photo = { id: 7, url: "/api/issues/100/photos/7", originalName: "leak.png", mimeType: "image/png", sizeBytes: 100 };
    const issue = sampleIssue({ photoCount: 1 });
    issue.events[0].photos = [photo];
    let photoAuth;
    let commentBody;
    const fetchMock = signedInAs(landlordUser, {
      "GET /issues/100": () => ({ body: issue }),
      "GET /issues/100/photos/7": () => ({ body: "binary" }),
      "POST /issues/100/comments": (_u, init) => {
        commentBody = init.body;
        return {
          status: 201,
          body: {
            ...issue,
            events: [...issue.events, { id: 2, type: "comment", actor: { id: 1, name: "Maria Garcia", role: "landlord" }, body: null, createdAt: new Date().toISOString(), photos: [{ ...photo, id: 8, url: "/api/issues/100/photos/8", originalName: "after.png" }] }],
          },
        };
      },
      "GET /issues/100/photos/8": () => ({ body: "binary" }),
    });
    const user = userEvent.setup();
    renderApp("/issues/100");

    expect(await screen.findByRole("button", { name: "Open leak.png" })).toBeInTheDocument();
    photoAuth = fetchMock.mock.calls.find(([url]) => url === "/api/issues/100/photos/7")[1].headers.Authorization;
    expect(photoAuth).toBe("Bearer token");

    const comment = screen.getByRole("button", { name: "Comment" });
    expect(comment).toBeDisabled();
    await user.upload(screen.getByLabelText("📷 Attach photo"), png("after.png"));
    expect(comment).toBeEnabled();
    await user.click(comment);

    expect(commentBody).toBeInstanceOf(FormData);
    expect(commentBody.get("body")).toBeNull();
    const history = screen.getByRole("list", { name: "Issue history" });
    expect(await within(history).findByText(/added 1 photo/)).toBeInTheDocument();
    expect(await within(history).findByRole("button", { name: "Open after.png" })).toBeInTheDocument();
  });
});
