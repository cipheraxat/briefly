import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import { BriefingWorkflow } from "./workflow";
import {
  DEFAULT_PREFERENCES,
  LLAMA_MODEL,
  type ActiveBrief,
  type BriefingState,
  type BriefPreferences,
  type SavedBrief
} from "./types";

export { BriefingWorkflow };

export class BriefingAgent extends AIChatAgent<Env, BriefingState> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  initialState: BriefingState = {
    preferences: { ...DEFAULT_PREFERENCES },
    briefs: [],
    activeBrief: null
  };

  private memorySystemPrompt(): string {
    const prefs = this.state.preferences;
    const tone = prefs.tone?.trim() ? ` Tone note: ${prefs.tone.trim()}.` : "";
    const titles =
      this.state.briefs.length === 0
        ? "None yet."
        : this.state.briefs
            .map((b) => `- ${b.title} (${b.topic}) [${b.id}]`)
            .join("\n");

    const latest = this.state.briefs[0];
    const latestBlock = latest
      ? `\nLatest brief body (id ${latest.id}):\n${latest.body}`
      : "";

    const active = this.state.activeBrief;
    const activeBlock = active
      ? `\nActive briefing workflow: topic "${active.topic}", step ${active.step ?? "starting"}, status ${active.status ?? "pending"}.`
      : "";

    return `You are Briefly, an AI briefing assistant on Cloudflare.

Help the user with short questions directly. When they want a researched brief, summary, or write-up on a topic, call startBrief.

Prefer remembering lasting format choices with rememberPreference (bullets vs prose, short vs standard, optional tone).

Current preferences: format=${prefs.format}, length=${prefs.length}.${tone}
Saved briefs:
${titles}${latestBlock}${activeBlock}

After startBrief returns, tell the user the brief is running in the background and they can watch progress in the Memory panel. Do not invent brief content before the workflow finishes.`;
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai(LLAMA_MODEL, {
        sessionAffinity: this.sessionAffinity
      }),
      system: this.memorySystemPrompt(),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools: {
        rememberPreference: tool({
          description:
            "Save the user's lasting brief preferences (format, length, optional tone).",
          inputSchema: z.object({
            format: z
              .enum(["bullets", "prose"])
              .optional()
              .describe("Preferred brief format"),
            length: z
              .enum(["short", "standard"])
              .optional()
              .describe("Preferred brief length"),
            tone: z
              .string()
              .optional()
              .describe("Optional tone note, e.g. executive or casual")
          }),
          execute: async ({ format, length, tone }) => {
            const next: BriefPreferences = {
              ...this.state.preferences,
              ...(format ? { format } : {}),
              ...(length ? { length } : {}),
              ...(tone !== undefined ? { tone: tone.trim() || undefined } : {})
            };
            this.setState({
              ...this.state,
              preferences: next
            });
            return {
              ok: true,
              preferences: next
            };
          }
        }),

        startBrief: tool({
          description:
            "Start a durable multi-step briefing workflow for a topic. Use when the user asks for a brief, summary, or write-up.",
          inputSchema: z.object({
            topic: z.string().min(3).describe("What the brief should cover")
          }),
          execute: async ({ topic }) => {
            const instanceId = await this.runWorkflow("BRIEFING_WORKFLOW", {
              topic,
              preferences: this.state.preferences
            });

            const activeBrief: ActiveBrief = {
              instanceId,
              topic,
              step: "queued",
              status: "pending",
              percent: 0,
              message: "Queued"
            };

            this.setState({
              ...this.state,
              activeBrief
            });

            return {
              ok: true,
              instanceId,
              topic,
              message:
                "Briefing workflow started. Progress will update in the Memory panel."
            };
          }
        })
      },
      stopWhen: stepCountIs(8),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }

  async onWorkflowProgress(
    _workflowName: string,
    instanceId: string,
    progress: unknown
  ) {
    const p = progress as {
      step?: string;
      status?: ActiveBrief["status"];
      percent?: number;
      message?: string;
    };

    const current = this.state.activeBrief;
    if (!current || current.instanceId !== instanceId) return;

    this.setState({
      ...this.state,
      activeBrief: {
        ...current,
        step: p.step ?? current.step,
        status: p.status ?? current.status,
        percent: p.percent ?? current.percent,
        message: p.message ?? current.message
      }
    });
  }

  async onWorkflowComplete(
    _workflowName: string,
    instanceId: string,
    _result?: unknown
  ) {
    const current = this.state.activeBrief;
    if (!current || current.instanceId !== instanceId) return;

    this.setState({
      ...this.state,
      activeBrief: {
        ...current,
        step: "save",
        status: "complete",
        percent: 1,
        message: "Brief ready"
      }
    });
  }

  async onWorkflowError(
    _workflowName: string,
    instanceId: string,
    error: unknown
  ) {
    const current = this.state.activeBrief;
    if (!current || current.instanceId !== instanceId) return;

    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Briefing failed";

    this.setState({
      ...this.state,
      activeBrief: {
        ...current,
        status: "error",
        message
      }
    });
  }

  /** Called by BriefingWorkflow via RPC to persist the finished brief. */
  async saveBrief(input: {
    title: string;
    topic: string;
    body: string;
  }): Promise<SavedBrief> {
    const brief: SavedBrief = {
      id: crypto.randomUUID(),
      title: input.title,
      topic: input.topic,
      body: input.body,
      createdAt: new Date().toISOString()
    };

    this.setState({
      ...this.state,
      briefs: [brief, ...this.state.briefs].slice(0, 20),
      activeBrief: {
        instanceId: this.state.activeBrief?.instanceId ?? "unknown",
        topic: input.topic,
        step: "save",
        status: "complete",
        percent: 1,
        message: "Brief ready"
      }
    });

    return brief;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
