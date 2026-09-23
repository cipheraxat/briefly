# Briefly

AI briefing agent on Cloudflare for the Agents assignment.

Chat for quick answers. Ask for a brief and a durable Workflow plans, drafts, revises, and saves it. Preferences and finished briefs survive refresh via Durable Object SQLite.

## Assignment checklist

| Requirement | Implementation |
| --- | --- |
| LLM | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Llama 3.3) |
| Workflow / coordination | `BriefingWorkflow` (`AgentWorkflow`) with plan → draft → revise → save |
| User input | React chat UI (`useAgentChat`) over WebSockets |
| Memory / state | Chat transcript in SQLite; preferences + saved briefs in agent `state` |

## Stack

- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (`AIChatAgent`, Durable Objects)
- [Workers AI](https://developers.cloudflare.com/workers-ai/) via `workers-ai-provider`
- [Cloudflare Workflows](https://developers.cloudflare.com/agents/concepts/workflows/) via `agents/workflows`
- Vite + React frontend served as Worker assets

## Quick start

```bash
npm install
npx wrangler login   # needed so local Workers AI calls work
npm run dev
```

Open the printed local URL (usually http://localhost:5173).

## Demo script (~60 seconds)

1. Click **Prefer short bullet briefs with an executive tone** (or type it). Confirm Preferences in the Memory panel update.
2. Click **Brief me on Cloudflare Durable Objects** (or ask for any brief). Watch Active brief steps: plan → draft → revise → save.
3. Refresh the page. Chat history, preferences, and the saved brief should still be there.
4. Click the saved brief (or ask what it covered). The agent should use memory.

## Deploy

```bash
npm run deploy
```

## Project layout

- `src/server.ts` — `BriefingAgent` (chat, tools, memory callbacks)
- `src/workflow.ts` — `BriefingWorkflow` (durable multi-step brief)
- `src/app.tsx` — chat + Memory panel
- `src/types.ts` — shared types and model id
- `wrangler.jsonc` — AI, Durable Object, and Workflow bindings

## Notes

- Each browser gets a stable agent instance id in `localStorage` (`briefly-session-id`) so refresh reconnects to the same Durable Object.
- Clearing chat only clears the transcript; preferences and saved briefs remain until you wipe the Durable Object / use a new session id.
