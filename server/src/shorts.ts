// A short is one takeaway pulled from one saved item.
// Until ingestion exists, the five samples shown on the landing page are the whole library.

export type Short = {
  id: string;
  source: string;
  from: string;
  url?: string;
  takeaway: string;
  why: string;
  kind: "skill" | "rules";
  slug: string;
};

export const SAMPLE_SHORTS: Short[] = [
  {
    id: "grill",
    source: "GitHub star",
    from: "mattpocock/skills",
    url: "https://github.com/mattpocock/skills",
    takeaway: "Make your agent interview you before it plans.",
    why: "Vague prompts waste most agent runs. Three questions up front pin down who it's for, what done means and what's out of scope.",
    kind: "skill",
    slug: "grill-me",
  },
  {
    id: "verify",
    source: "YouTube, Watch Later",
    from: "Evals for coding agents, end to end",
    takeaway: "Write the check before the agent says done.",
    why: "If the agent can declare victory without running anything, it will. A failing check it has to turn green makes done mean done.",
    kind: "skill",
    slug: "verify-journey",
  },
  {
    id: "split",
    source: "AI Engineer, New York 2025",
    from: "A talk from last year's playlist",
    takeaway: "Give each agent one job and one way to check it.",
    why: "One giant prompt doing planning, coding and review is hard to debug. Small agents with their own checks fail loudly and in one place.",
    kind: "rules",
    slug: "agent-roles",
  },
  {
    id: "judgment",
    source: "Substack",
    from: "kunchenguid: I distilled myself",
    url: "https://blog.kunchenguid.com/p/i-distilled-myself-and-you-should",
    takeaway: "Write down the correction you keep repeating.",
    why: "Every repeated correction is a rule your agent doesn't have yet. Writing it once saves the next ten reminders.",
    kind: "rules",
    slug: "review-rules",
  },
  {
    id: "route",
    source: "X bookmark",
    from: "cursor/plugins: pstack",
    url: "https://github.com/cursor/plugins/tree/main/pstack",
    takeaway: "Route every task through design, build and verify.",
    why: "Jumping straight to code skips the two steps that catch the expensive mistakes. A fixed route makes the agent stop at both.",
    kind: "skill",
    slug: "pstack-route",
  },
];
