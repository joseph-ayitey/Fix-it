import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE = "FixIt";

// Public pages: the only ones search engines should list. Everything else is private
// (your dashboard, issues, properties), so it's marked noindex. robots.txt says the same
// for crawlers that don't run JavaScript.
const PUBLIC_TITLES = {
  "/": `${SITE}: home repairs, sorted, for landlords, tenants and workers`,
  "/login": `Sign in · ${SITE}`,
  "/signup": `Create your account · ${SITE}`,
};

const PRIVATE_TITLES = [
  [/^\/$/, "Dashboard"],
  [/^\/issues\/new$/, "Report an issue"],
  [/^\/issues\/\d+$/, "Issue"],
  [/^\/issues$/, "Issues"],
  [/^\/properties\/new$/, "Add a property"],
  [/^\/properties\/\d+$/, "Property"],
  [/^\/properties$/, "Properties"],
  [/^\/join$/, "Join your home"],
  [/^\/team$/, "Team"],
];

function setRobots(content) {
  let tag = document.querySelector('meta[name="robots"]');
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = "robots";
    document.head.appendChild(tag);
  }
  tag.content = content;
}

/**
 * Keeps the browser tab title and the robots meta tag right for the current page.
 * Titles help people with many tabs open, screen readers (the title is announced), and
 * search results. `signedIn` matters for "/": the landing page when signed out (public),
 * your dashboard when signed in (private).
 */
export function usePageMeta(signedIn) {
  const { pathname } = useLocation();
  useEffect(() => {
    const isPublic = pathname in PUBLIC_TITLES && !(pathname === "/" && signedIn);
    if (isPublic) {
      document.title = PUBLIC_TITLES[pathname];
      setRobots("index, follow");
      return;
    }
    const match = PRIVATE_TITLES.find(([pattern]) => pattern.test(pathname));
    document.title = match ? `${match[1]} · ${SITE}` : `Page not found · ${SITE}`;
    setRobots("noindex, nofollow");
  }, [pathname, signedIn]);
}
