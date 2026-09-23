import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { BriefingAgent } from "./server";
import type { BriefingState, SavedBrief } from "./types";
import { DEFAULT_PREFERENCES } from "./types";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  PoweredByCloudflare,
  Surface,
  Text
} from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  GearIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  CheckCircleIcon,
  XCircleIcon,
  FileTextIcon,
  SparkleIcon,
  BookmarkIcon
} from "@phosphor-icons/react";

const SESSION_KEY = "briefly-session-id";

function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          <pre className="mt-0.5 font-mono text-xs text-kumo-subtle whitespace-pre-wrap overflow-auto max-h-40">
            {JSON.stringify(part.output, null, 2)}
          </pre>
        </Surface>
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring-2 ring-kumo-danger">
          <div className="flex items-center gap-2">
            <XCircleIcon size={14} className="text-kumo-danger" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="destructive">Error</Badge>
          </div>
        </Surface>
      </div>
    );
  }

  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  return null;
}

const WORKFLOW_STEPS = ["plan", "draft", "revise", "save"] as const;

function stepIndex(step?: string): number {
  if (!step) return -1;
  const normalized =
    step === "queued"
      ? -1
      : WORKFLOW_STEPS.indexOf(step as (typeof WORKFLOW_STEPS)[number]);
  return normalized;
}

function MemoryPanel({
  state,
  onAskAboutBrief
}: {
  state: BriefingState;
  onAskAboutBrief: (brief: SavedBrief) => void;
}) {
  const active = state.activeBrief;
  const currentIdx = stepIndex(active?.step);
  const prefs = state.preferences;

  return (
    <aside className="w-full lg:w-80 shrink-0 border-l border-kumo-line bg-kumo-base overflow-y-auto">
      <div className="p-4 space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <SparkleIcon size={16} className="text-kumo-accent" />
            <Text size="sm" bold>
              Preferences
            </Text>
          </div>
          <Surface className="rounded-xl ring ring-kumo-line p-3 space-y-1.5">
            <Text size="xs" variant="secondary">
              Format: <span className="text-kumo-default">{prefs.format}</span>
            </Text>
            <Text size="xs" variant="secondary">
              Length: <span className="text-kumo-default">{prefs.length}</span>
            </Text>
            <Text size="xs" variant="secondary">
              Tone:{" "}
              <span className="text-kumo-default">
                {prefs.tone?.trim() || "default"}
              </span>
            </Text>
          </Surface>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <FileTextIcon size={16} className="text-kumo-accent" />
            <Text size="sm" bold>
              Active brief
            </Text>
          </div>
          {!active ? (
            <Text size="xs" variant="secondary">
              No briefing workflow running. Ask for a brief on any topic.
            </Text>
          ) : (
            <Surface className="rounded-xl ring ring-kumo-line p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <Text size="xs" bold>
                  {active.topic}
                </Text>
                <Badge
                  variant={
                    active.status === "error"
                      ? "destructive"
                      : active.status === "complete"
                        ? "primary"
                        : "secondary"
                  }
                >
                  {active.status ?? "pending"}
                </Badge>
              </div>
              <ol className="space-y-2">
                {WORKFLOW_STEPS.map((step, idx) => {
                  const done =
                    active.status === "complete" ||
                    (currentIdx > idx && active.status !== "error");
                  const current =
                    currentIdx === idx && active.status !== "complete";
                  return (
                    <li key={step} className="flex items-center gap-2">
                      {done ? (
                        <CheckCircleIcon
                          size={14}
                          className="text-kumo-success"
                        />
                      ) : current ? (
                        <CircleIcon
                          size={14}
                          weight="fill"
                          className="text-kumo-brand animate-pulse"
                        />
                      ) : (
                        <CircleIcon size={14} className="text-kumo-inactive" />
                      )}
                      <Text
                        size="xs"
                        variant={current || done ? "body" : "secondary"}
                      >
                        {step}
                      </Text>
                    </li>
                  );
                })}
              </ol>
              {active.message && (
                <Text size="xs" variant="secondary">
                  {active.message}
                </Text>
              )}
            </Surface>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookmarkIcon size={16} className="text-kumo-accent" />
            <Text size="sm" bold>
              Saved briefs
            </Text>
            {state.briefs.length > 0 && (
              <Badge variant="secondary">{state.briefs.length}</Badge>
            )}
          </div>
          {state.briefs.length === 0 ? (
            <Text size="xs" variant="secondary">
              Finished briefs stay here after a refresh.
            </Text>
          ) : (
            <div className="space-y-2">
              {state.briefs.map((brief) => (
                <button
                  key={brief.id}
                  type="button"
                  onClick={() => onAskAboutBrief(brief)}
                  className="w-full text-left rounded-xl ring ring-kumo-line p-3 hover:bg-kumo-control transition-colors"
                >
                  <Text size="xs" bold>
                    {brief.title}
                  </Text>
                  <Text size="xs" variant="secondary">
                    {brief.topic}
                  </Text>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function Chat() {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [agentState, setAgentState] = useState<BriefingState>({
    preferences: { ...DEFAULT_PREFERENCES },
    briefs: [],
    activeBrief: null
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent<BriefingAgent, BriefingState>({
    agent: "BriefingAgent",
    name: sessionId,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback((error: Event) => {
      console.error("WebSocket error:", error);
    }, []),
    onStateUpdate: useCallback((state: BriefingState) => {
      setAgentState(state);
    }, [])
  });

  const { messages, sendMessage, clearHistory, stop, status } = useAgentChat({
    agent,
    experimental_throttle: 100
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentState.activeBrief]);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  const askAboutBrief = useCallback(
    (brief: SavedBrief) => {
      if (isStreaming) return;
      sendMessage({
        role: "user",
        parts: [
          {
            type: "text",
            text: `Remind me what the brief "${brief.title}" covered, and give me the key takeaways.`
          }
        ]
      });
    },
    [isStreaming, sendMessage]
  );

  const prompts = [
    "Prefer short bullet briefs with an executive tone",
    "Brief me on Cloudflare Durable Objects",
    "What preferences do you remember?"
  ];

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-lg font-semibold text-kumo-default truncate">
              Briefly
            </h1>
            <Badge variant="secondary">
              <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
              Llama 3.3 briefings
            </Badge>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <ThemeToggle />
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={clearHistory}
            >
              Clear chat
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row max-w-6xl w-full mx-auto">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="px-5 py-6 space-y-5">
              {messages.length === 0 && (
                <Empty
                  icon={<ChatCircleDotsIcon size={32} />}
                  title="Ask for a brief"
                  contents={
                    <div className="space-y-3">
                      <Text size="sm" variant="secondary">
                        Chat for quick answers. Ask for a brief to start a
                        durable multi-step Workflow. Preferences and finished
                        briefs persist after refresh.
                      </Text>
                      <div className="flex flex-wrap justify-center gap-2">
                        {prompts.map((prompt) => (
                          <Button
                            key={prompt}
                            variant="outline"
                            size="sm"
                            disabled={isStreaming || !connected}
                            onClick={() => {
                              sendMessage({
                                role: "user",
                                parts: [{ type: "text", text: prompt }]
                              });
                            }}
                          >
                            {prompt}
                          </Button>
                        ))}
                      </div>
                    </div>
                  }
                />
              )}

              {messages.map((message: UIMessage, index: number) => {
                const isUser = message.role === "user";
                const isLastAssistant =
                  message.role === "assistant" && index === messages.length - 1;

                return (
                  <div key={message.id} className="space-y-2">
                    {message.parts.map((part, i) => {
                      const key = `${message.id}-${i}`;

                      if (isToolUIPart(part)) {
                        return <ToolPartView key={key} part={part} />;
                      }

                      if (part.type === "text") {
                        if (!part.text) return null;
                        if (isUser) {
                          return (
                            <div key={key} className="flex justify-end">
                              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                                {part.text}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={key} className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                              <Streamdown
                                className="sd-theme rounded-2xl rounded-bl-md p-3"
                                plugins={{ code }}
                                controls={false}
                                isAnimating={isLastAssistant && isStreaming}
                              >
                                {part.text}
                              </Streamdown>
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="border-t border-kumo-line bg-kumo-base">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="px-5 py-4"
            >
              <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
                <InputArea
                  ref={textareaRef}
                  value={input}
                  onValueChange={setInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  placeholder="Ask a question or request a brief..."
                  disabled={!connected || isStreaming}
                  rows={1}
                  className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
                />
                {isStreaming ? (
                  <Button
                    type="button"
                    variant="secondary"
                    shape="square"
                    aria-label="Stop generation"
                    icon={<StopIcon size={18} />}
                    onClick={stop}
                    className="mb-0.5"
                  />
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    shape="square"
                    aria-label="Send message"
                    disabled={!input.trim() || !connected}
                    icon={<PaperPlaneRightIcon size={18} />}
                    className="mb-0.5"
                  />
                )}
              </div>
            </form>
            <div className="flex justify-center pb-3">
              <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
            </div>
          </div>
        </div>

        <MemoryPanel state={agentState} onAskAboutBrief={askAboutBrief} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading Briefly...
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}
