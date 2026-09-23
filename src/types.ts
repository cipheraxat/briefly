export type BriefFormat = "bullets" | "prose";
export type BriefLength = "short" | "standard";

export type BriefPreferences = {
  format: BriefFormat;
  length: BriefLength;
  tone?: string;
};

export type SavedBrief = {
  id: string;
  title: string;
  topic: string;
  body: string;
  createdAt: string;
};

export type ActiveBrief = {
  instanceId: string;
  topic: string;
  step?: string;
  status?: "pending" | "running" | "complete" | "error";
  percent?: number;
  message?: string;
};

export type BriefingState = {
  preferences: BriefPreferences;
  briefs: SavedBrief[];
  activeBrief: ActiveBrief | null;
};

export type BriefingWorkflowParams = {
  topic: string;
  preferences: BriefPreferences;
};

export type BriefPlan = {
  title: string;
  outline: string[];
};

export type BriefDraft = {
  title: string;
  body: string;
};

export const LLAMA_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export const DEFAULT_PREFERENCES: BriefPreferences = {
  format: "bullets",
  length: "standard"
};
