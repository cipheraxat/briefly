import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { BriefingAgent } from "./server";
import {
  LLAMA_MODEL,
  type BriefDraft,
  type BriefingWorkflowParams,
  type BriefPlan,
  type BriefPreferences,
  type SavedBrief
} from "./types";

type AiTextResponse = {
  response?: string;
};

function extractText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (result && typeof result === "object") {
    const maybe = result as AiTextResponse;
    if (typeof maybe.response === "string") return maybe.response.trim();
  }
  return JSON.stringify(result);
}

function parseJsonObject<T extends Record<string, unknown>>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Expected JSON object, got: ${text.slice(0, 200)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

function preferenceInstructions(preferences: BriefPreferences): string {
  const tone = preferences.tone?.trim()
    ? ` Tone: ${preferences.tone.trim()}.`
    : "";
  return `Format: ${preferences.format}. Length: ${preferences.length}.${tone}`;
}

export class BriefingWorkflow extends AgentWorkflow<
  BriefingAgent,
  BriefingWorkflowParams
> {
  async run(
    event: AgentWorkflowEvent<BriefingWorkflowParams>,
    step: AgentWorkflowStep
  ) {
    const { topic, preferences } = event.payload;
    const retries = {
      retries: {
        limit: 3,
        delay: "5 seconds" as const,
        backoff: "linear" as const
      }
    };

    await this.reportProgress({
      step: "plan",
      status: "running",
      percent: 0.1,
      message: "Planning the brief..."
    });

    const plan = (await step.do("plan", retries, async () => {
      const result = await this.env.AI.run(LLAMA_MODEL, {
        messages: [
          {
            role: "system",
            content:
              "You plan concise research briefs. Reply with JSON only: " +
              '{"title": string, "outline": string[]} with 3-5 outline items.'
          },
          {
            role: "user",
            content: `Topic: ${topic}\n${preferenceInstructions(preferences)}`
          }
        ]
      });

      const parsed = parseJsonObject<{ title?: string; outline?: unknown }>(
        extractText(result)
      );
      const outline = Array.isArray(parsed.outline)
        ? parsed.outline.filter((item): item is string => typeof item === "string")
        : [];

      if (!parsed.title || outline.length === 0) {
        throw new Error("Plan step returned invalid title/outline");
      }

      return { title: parsed.title, outline } satisfies BriefPlan;
    })) as BriefPlan;

    await this.reportProgress({
      step: "draft",
      status: "running",
      percent: 0.4,
      message: "Drafting from the outline..."
    });

    const draft = (await step.do("draft", retries, async () => {
      const result = await this.env.AI.run(LLAMA_MODEL, {
        messages: [
          {
            role: "system",
            content:
              "You write research briefs. Reply with JSON only: " +
              '{"title": string, "body": string}. Body should be markdown.'
          },
          {
            role: "user",
            content:
              `Topic: ${topic}\nTitle: ${plan.title}\n` +
              `Outline:\n- ${plan.outline.join("\n- ")}\n` +
              preferenceInstructions(preferences)
          }
        ]
      });

      const parsed = parseJsonObject<{ title?: string; body?: string }>(
        extractText(result)
      );
      if (!parsed.title || !parsed.body) {
        throw new Error("Draft step returned invalid title/body");
      }
      return { title: parsed.title, body: parsed.body } satisfies BriefDraft;
    })) as BriefDraft;

    await this.reportProgress({
      step: "revise",
      status: "running",
      percent: 0.7,
      message: "Applying your preferences..."
    });

    const revised = (await step.do("revise", retries, async () => {
      const result = await this.env.AI.run(LLAMA_MODEL, {
        messages: [
          {
            role: "system",
            content:
              "You revise briefs to match user preferences. Reply with JSON only: " +
              '{"title": string, "body": string}. Keep facts, improve clarity.'
          },
          {
            role: "user",
            content:
              `${preferenceInstructions(preferences)}\n\n` +
              `Title: ${draft.title}\n\nBody:\n${draft.body}`
          }
        ]
      });

      const parsed = parseJsonObject<{ title?: string; body?: string }>(
        extractText(result)
      );
      if (!parsed.title || !parsed.body) {
        throw new Error("Revise step returned invalid title/body");
      }
      return { title: parsed.title, body: parsed.body } satisfies BriefDraft;
    })) as BriefDraft;

    await this.reportProgress({
      step: "save",
      status: "running",
      percent: 0.9,
      message: "Saving the brief to memory..."
    });

    const saved = (await step.do("save", retries, async () => {
      const brief = await this.agent.saveBrief({
        title: revised.title,
        topic,
        body: revised.body
      });
      // Stub RPC can attach Disposable; Workflow steps need plain serializable JSON.
      return {
        id: brief.id,
        title: brief.title,
        topic: brief.topic,
        body: brief.body,
        createdAt: brief.createdAt
      };
    })) as SavedBrief;

    await this.reportProgress({
      step: "save",
      status: "complete",
      percent: 1,
      message: "Brief ready"
    });

    await step.reportComplete(saved);
    return saved;
  }
}
