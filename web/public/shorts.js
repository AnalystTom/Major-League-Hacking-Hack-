// Pre-generated sample shorts: one takeaway per saved item, each with a small motion scene.
// Scene markup is static and trusted; --d sets when each element animates in.

export const SHORTS = [
  {
    id: "grill",
    accent: "violet",
    source: "GitHub star",
    from: "mattpocock/skills",
    age: "Saved 41 days ago",
    takeaway: "Make your agent interview you before it plans.",
    why: "Vague prompts waste most agent runs. Three questions up front pin down who it's for, what done means and what's out of scope.",
    kind: "skill",
    slug: "grill-me",
    scene: `
      <div class="sc sc-grill">
        <p class="bubble" style="--d:1.1s">Who is this for?</p>
        <p class="bubble" style="--d:1.8s">What does done look like?</p>
        <p class="bubble" style="--d:2.5s">What stays out of scope?</p>
        <div class="mini-file" style="--d:3.6s"><code>plan.md</code><i></i><i></i><i class="half"></i></div>
      </div>`,
  },
  {
    id: "verify",
    accent: "signal",
    source: "YouTube, Watch Later",
    from: "Evals for coding agents, end to end",
    age: "Saved 214 days ago",
    takeaway: "Write the check before the agent says done.",
    why: "If the agent can declare victory without running anything, it will. A failing check it has to turn green makes done mean done.",
    kind: "skill",
    slug: "verify-journey",
    scene: `
      <div class="sc sc-verify">
        <div class="claim" style="--d:1s"><code>agent: all done!</code><b style="--d:1.6s">not yet</b></div>
        <ul class="checks">
          <li style="--d:2.1s">form submits</li>
          <li style="--d:2.6s">email is saved</li>
          <li style="--d:3.1s">bad input shows an error</li>
        </ul>
        <p class="verdict" style="--d:3.9s">Done, with proof</p>
      </div>`,
  },
  {
    id: "split",
    accent: "amber",
    source: "AI Engineer, New York 2025",
    from: "A talk from last year's playlist",
    age: "In Watch Later since 2025",
    takeaway: "Give each agent one job and one way to check it.",
    why: "One giant prompt doing planning, coding and review is hard to debug. Small agents with their own checks fail loudly and in one place.",
    kind: "rules",
    slug: "agent-roles",
    scene: `
      <div class="sc sc-split">
        <svg viewBox="0 0 200 170" aria-hidden="true">
          <line class="edge" x1="100" y1="80" x2="40" y2="140" style="--d:2.2s"/>
          <line class="edge" x1="100" y1="80" x2="160" y2="140" style="--d:2.4s"/>
          <line class="edge" x1="100" y1="80" x2="100" y2="22" style="--d:2.6s"/>
          <circle class="blob" cx="100" cy="80" r="44"/>
          <g class="node" style="--d:2.4s; --x:-60px; --y:60px"><circle cx="100" cy="80" r="17"/><text x="100" y="84">plan</text></g>
          <g class="node" style="--d:2.6s; --x:60px; --y:60px"><circle cx="100" cy="80" r="17"/><text x="100" y="84">code</text></g>
          <g class="node" style="--d:2.8s; --x:0px; --y:-58px"><circle cx="100" cy="80" r="17"/><text x="100" y="84">check</text></g>
        </svg>
      </div>`,
  },
  {
    id: "judgment",
    accent: "coral",
    source: "Substack",
    from: "kunchenguid: I distilled myself",
    age: "Saved 23 days ago",
    takeaway: "Write down the correction you keep repeating.",
    why: "Every repeated correction is a rule your agent doesn't have yet. Writing it once saves the next ten reminders.",
    kind: "rules",
    slug: "review-rules",
    scene: `
      <div class="sc sc-judgment">
        <div class="fixes">
          <p style="--d:1s">"Use pnpm, not npm." <b>1</b></p>
          <p style="--d:1.6s">"Use pnpm, not npm." <b>2</b></p>
          <p style="--d:2.2s">"Use pnpm, not npm." <b>3</b></p>
        </div>
        <div class="mini-file rule" style="--d:3.4s"><code>AGENTS.md</code><span>Use pnpm for every install.</span></div>
      </div>`,
  },
  {
    id: "route",
    accent: "sky",
    source: "X bookmark",
    from: "cursor/plugins: pstack",
    age: "Saved 12 days ago",
    takeaway: "Route every task through design, build and verify.",
    why: "Jumping straight to code skips the two steps that catch the expensive mistakes. A fixed route makes the agent stop at both.",
    kind: "skill",
    slug: "pstack-route",
    scene: `
      <div class="sc sc-route">
        <div class="stations">
          <span style="--d:1.3s">Design</span>
          <span style="--d:2.2s">Build</span>
          <span style="--d:3.1s">Verify</span>
          <i class="runner"></i>
        </div>
      </div>`,
  },
];

// The SKILL.md a short becomes: the format Claude Code, Codex and Hermes read as a skill.
export const skillMarkdown = (short) =>
  `---\nname: ${short.slug}\ndescription: ${short.takeaway}\n---\n\n# ${short.takeaway}\n\n${short.why}\n\nSource: ${short.source}, ${short.from}\n`;

// The takeaway set as words, so each can compress into place on its own beat.
export const kinetic = (text) =>
  text
    .split(" ")
    .map((w, i) => `<span class="kw" style="--i:${i}">${w}</span>`)
    .join(" ");

export function shortMarkup(short) {
  return `
    <article class="short" data-accent="${short.accent}" data-id="${short.id}">
      <div class="short-progress"><i></i></div>
      <div class="short-meta">
        <span class="short-source">${short.source}</span>
        <span class="short-age">${short.age}</span>
      </div>
      <p class="short-takeaway">${kinetic(short.takeaway)}</p>
      <div class="short-scene" aria-hidden="true">${short.scene}</div>
      <p class="short-from">From ${short.from}</p>
      <p class="short-sent" aria-hidden="true">Sent to your agents</p>
    </article>`;
}
