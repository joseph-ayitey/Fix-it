import { Link } from "react-router-dom";

// The public front page: what FixIt is, how a repair flows from report to "fixed", and
// how each kind of user gets started. Every "Join as ..." button opens sign-up with that
// role already chosen, because the role is the one choice you can't change later.

const FLOW = [
  {
    who: "Tenant",
    title: "Report what's broken",
    text: "Describe it, choose how urgent it is, add photos. Your landlord sees it straight away.",
  },
  {
    who: "Landlord",
    title: "Send it to the right worker",
    text: "Find a worker by trade (plumber, electrician, locksmith…) and send them a job offer.",
  },
  {
    who: "Worker",
    title: "Accept, fix, mark as fixed",
    text: "Accept the offer to get the address, do the job, and mark it fixed, with an \"after\" photo.",
  },
  {
    who: "Tenant + landlord",
    title: "Both confirm, it's closed",
    text: "The tenant confirms it works, the landlord approves the work. Either can send it back with a reason.",
  },
];

const ROLES = [
  {
    role: "landlord",
    title: "Landlords",
    pitch: "Every repair across your properties in one inbox, urgent and longest-waiting first.",
    steps: [
      "Create a landlord account.",
      "Add your properties. Each gets a join code.",
      "Share each property's join code with its tenants.",
      "When an issue comes in, find a worker by trade and send a job offer.",
      "Approve the work once it's fixed, or send it back.",
    ],
  },
  {
    role: "tenant",
    title: "Tenants",
    pitch: "Report a problem once, and see exactly where it stands until it's fixed.",
    steps: [
      "Ask your landlord for your home's join code.",
      "Create a tenant account and enter the code.",
      "Report issues with photos and urgency.",
      "See who's coming (\"Marc R. · Plumber\") and follow every update.",
      "Confirm when it's fixed, or reopen it if it isn't.",
    ],
  },
  {
    role: "worker",
    title: "Workers",
    pitch: "Get repair jobs from landlords who need your trade. You choose which ones to take.",
    steps: [
      "Create a worker account with your trade and area.",
      "Landlords find you by trade and send you job offers.",
      "See the job before deciding. Accept or decline.",
      "Accepted jobs show the address, and a private thread with the landlord.",
      "Mark the job as fixed when you're done.",
    ],
  },
];

const WHY = [
  ["One shared record", "Every report, message, photo and status change is on one timeline with who and when. No more \"I told you weeks ago\"."],
  ["Nothing waits unseen", "Everyone sees how long an issue has gone without a response. Urgent issues are flagged and sorted first."],
  ["Privacy by default", "Workers see an address only after accepting a job. Prices and instructions go in a private landlord-worker thread."],
  ["Fixed means fixed", "An issue closes only when the tenant confirms it works and the landlord approves the work."],
];

export default function LandingPage() {
  return (
    <div className="landing">
      <section className="hero">
        <h1 className="hero__title">Home repairs, sorted.</h1>
        <p className="hero__lead">
          FixIt connects <strong>tenants</strong> who report what's broken, <strong>landlords</strong> who organise the
          repair, and <strong>workers</strong> who fix it, on one shared timeline from "it's leaking" to "it's fixed".
        </p>
        <div className="button-row hero__actions">
          <a href="#join" className="button">
            Get started
          </a>
          <Link to="/login" className="button button--ghost">
            Sign in
          </Link>
        </div>
      </section>

      <section className="landing__section" aria-labelledby="how">
        <h2 id="how">How a repair works</h2>
        <ol className="flow">
          {FLOW.map((step, i) => (
            <li key={step.title} className="flow__step">
              <span className="flow__number" aria-hidden="true">
                {i + 1}
              </span>
              <span className="flow__who">{step.who}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing__section" aria-labelledby="join">
        <h2 id="join">Who are you?</h2>
        <p className="muted">Pick your role carefully: it decides what you can do and can't be changed later.</p>
        <div className="role-cards">
          {ROLES.map((r) => (
            <article key={r.role} className="role-card">
              <h3>{r.title}</h3>
              <p className="role-card__pitch">{r.pitch}</p>
              <ol className="role-card__steps">
                {r.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <Link to={`/signup?role=${r.role}`} className="button role-card__cta">
                Join as a {r.role}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="landing__section" aria-labelledby="why">
        <h2 id="why">Why it works</h2>
        <div className="why">
          {WHY.map(([title, text]) => (
            <div key={title} className="why__item">
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing__cta">
        <h2>Ready?</h2>
        <div className="button-row">
          <Link to="/signup" className="button">
            Create an account
          </Link>
          <Link to="/login" className="button button--ghost">
            I already have one
          </Link>
        </div>
      </section>
    </div>
  );
}
