// A short is one takeaway pulled from one saved item.

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
