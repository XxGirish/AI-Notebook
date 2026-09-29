import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { citedPassageIds } from "@ai-notebook/ai-contract";
import type { NotebookPage } from "../../domain/pages";
import { answerForCanvas, buildChatRequest, citedPageSources } from "../../ai/chatRequest";
import { withContentHashes } from "../../domain/staleness";
import { cancelGeneration, GatewayError, streamChat } from "../../ai/gatewayClient";
import {
  clearChatMessages,
  deleteSource,
  loadChatMessages,
  loadSourceChunks,
  loadSources,
  saveChatMessage,
  setSourceEnabled,
  type ChatCitation,
  type ChatMessageRecord,
  type SourceRecord,
} from "../../persistence/notebookDatabase";
import { addSourceFile } from "../../sources/addSource";
import { ACCEPTED_SOURCE_TYPES, SourceExtractionError } from "../../sources/extractText";
import { NotebookRetriever, type RetrievedPassage } from "../../sources/retrieval";
import { isQuotaExceededError } from "../../persistence/storageHealth";
import { ChatMarkdown } from "./ChatMarkdown";
import "./chatDock.css";

export type ChatInsertOutcome = { ok: true } | { ok: false; message: string };

type Props = {
  pages: readonly NotebookPage[];
  activePageId: string;
  isOnline: boolean;
  readOnly: boolean;
  onAddToPage: (answer: { title: string; body: string; provider: string; model: string; sources?: Array<{ id: string; revision: number; contentHash?: string }> }) => Promise<ChatInsertOutcome>;
  onOpenPage: (pageId: string) => void;
  /** Changes when sources or chat were written outside the panel, such as by an import. */
  libraryGeneration: number;
};

type Streaming = { requestId: string; text: string; passages: RetrievedPassage[]; question: string };
type ChatFailure = { message: string; retryable: boolean; question: string; history: ChatMessageRecord[] };
type Upload = { id: string; name: string; progress?: number; error?: string };

const GATEWAY_ACCESS_TOKEN = import.meta.env.VITE_GATEWAY_ACCESS_TOKEN as string | undefined;
const OPEN_KEY = "ai-notebook.chat.open";
const NOTES_KEY = "ai-notebook.chat.includeNotes";
const SUGGESTIONS = ["Summarise my sources", "Quiz me on the key ideas", "Explain the hardest concept simply"];

const readFlag = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
};
const writeFlag = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // A remembered panel state is a convenience; the panel works without it.
  }
};

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const KIND_LABELS: Record<SourceRecord["kind"], string> = { pdf: "PDF", docx: "Word", text: "Text" };

function OrbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1L5 9.5l5.1-1.9L12 2.5z" fill="currentColor" />
      <path d="M18.5 14l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

export function ChatDock({ pages, activePageId, isOnline, readOnly, onAddToPage, onOpenPage, libraryGeneration }: Props) {
  const [open, setOpen] = useState(() => readFlag(OPEN_KEY, false));
  const [tab, setTab] = useState<"chat" | "sources">("chat");
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [includeNotes, setIncludeNotes] = useState(() => readFlag(NOTES_KEY, true));
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<Streaming>();
  const [failure, setFailure] = useState<ChatFailure>();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [activeCitation, setActiveCitation] = useState<{ messageId: string; id: string }>();
  const [addStatus, setAddStatus] = useState<Record<string, string>>({});
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string>();

  const retrieverRef = useRef(new NotebookRetriever());
  const loadingRef = useRef<Promise<void>>();
  const abortRef = useRef<AbortController>();
  const pagesRef = useRef(pages);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstRenderRef = useRef(true);
  pagesRef.current = pages;

  /** Sources and history load on first open, so a notebook that never uses chat pays nothing at start-up. */
  const ensureLoaded = useCallback(() => {
    loadingRef.current ??= (async () => {
      try {
        const [storedSources, chunks, history] = await Promise.all([loadSources(), loadSourceChunks(), loadChatMessages()]);
        retrieverRef.current.setSources(storedSources, chunks);
        setSources(storedSources);
        setMessages(history);
        setLoaded(true);
      } catch {
        loadingRef.current = undefined;
        setLoadError("Your sources and chat history could not be read from this browser's storage.");
      }
    })();
    return loadingRef.current;
  }, []);

  useEffect(() => {
    if (open) void ensureLoaded();
  }, [open, ensureLoaded]);

  // An import wrote sources or messages behind the panel's back: read them again.
  const seenLibraryGenerationRef = useRef(libraryGeneration);
  useEffect(() => {
    if (seenLibraryGenerationRef.current === libraryGeneration) return;
    seenLibraryGenerationRef.current = libraryGeneration;
    if (!loadingRef.current) return;
    loadingRef.current = undefined;
    void ensureLoaded();
  }, [libraryGeneration, ensureLoaded]);

  useEffect(() => {
    writeFlag(OPEN_KEY, open);
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (open) composerRef.current?.focus();
    else orbRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, streaming?.text, failure]);

  const enabledSourceIds = useMemo(() => new Set(sources.filter((source) => source.enabled).map((source) => source.id)), [sources]);

  const persist = (message: ChatMessageRecord) => {
    saveChatMessage(message).catch(() => setLoadError("The chat could not be saved; it will be lost on reload."));
  };

  const answer = async (question: string, history: ChatMessageRecord[]) => {
    const retriever = retrieverRef.current;
    retriever.setPages(pagesRef.current);
    const passages = retriever.retrieve({
      question,
      previousQuestions: history.filter((message) => message.role === "user").map((message) => message.content),
      enabledSourceIds,
      includeNotes,
      activePageId,
    });
    const requestId = newId("chat");
    const request = buildChatRequest({ requestId, history, question, passages });
    const sent = passages.slice(0, request.passages.length);
    const controller = new AbortController();
    abortRef.current = controller;
    setFailure(undefined);
    setStreaming({ requestId, text: "", passages: sent, question });

    let text = "";
    let provider = "unknown";
    let model = "unknown";
    let error: { message: string; retryable: boolean } | undefined;
    try {
      await streamChat(request, {
        accessToken: GATEWAY_ACCESS_TOKEN,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "started") {
            provider = event.provider;
            model = event.model;
          } else if (event.type === "delta") {
            text += event.text;
            setStreaming((current) => (current?.requestId === requestId ? { ...current, text } : current));
          } else if (event.type === "error") {
            error = { message: event.message, retryable: event.retryable };
          }
        },
      });
    } catch (caught) {
      if (!controller.signal.aborted) {
        error = caught instanceof GatewayError
          ? { message: caught.message, retryable: caught.retryable }
          : { message: "The gateway could not be reached. Check that it is running.", retryable: true };
      }
    } finally {
      abortRef.current = undefined;
      setStreaming(undefined);
    }

    const citations: ChatCitation[] = citedPassageIds(text, sent.map((passage) => passage.id))
      .map((id) => sent.find((passage) => passage.id === id)!.citation);
    const stopped = controller.signal.aborted;
    if (text.trim()) {
      const message: ChatMessageRecord = {
        id: newId("message"),
        role: "assistant",
        content: text,
        createdAt: Date.now(),
        citations,
        provider,
        model,
        ...(stopped || error ? { incomplete: true } : {}),
      };
      setMessages((current) => [...current, message]);
      persist(message);
    }
    if (error && !stopped) setFailure({ ...error, question, history });
  };

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || streaming || !isOnline) return;
    await ensureLoaded();
    const history = messages;
    const message: ChatMessageRecord = { id: newId("message"), role: "user", content: question, createdAt: Date.now() };
    setMessages((current) => [...current, message]);
    persist(message);
    setDraft("");
    setConfirmingClear(false);
    await answer(question, history);
  };

  const stop = () => {
    const requestId = streaming?.requestId;
    abortRef.current?.abort();
    if (requestId) void cancelGeneration(requestId, { accessToken: GATEWAY_ACCESS_TOKEN });
  };

  const reindexSources = async (next: SourceRecord[]) => {
    retrieverRef.current.setSources(next, await loadSourceChunks());
    setSources(next);
  };

  const addFiles = async (files: FileList | File[]) => {
    if (readOnly) return;
    await ensureLoaded();
    for (const file of Array.from(files)) {
      const uploadId = newId("upload");
      setUploads((current) => [...current, { id: uploadId, name: file.name }]);
      try {
        const result = await addSourceFile(file, (progress) => {
          setUploads((current) => current.map((upload) => (upload.id === uploadId ? { ...upload, progress } : upload)));
        });
        if (result.status === "duplicate") {
          setUploads((current) => current.map((upload) => (upload.id === uploadId ? { ...upload, error: `Already added as “${result.source.name}”.` } : upload)));
          continue;
        }
        await reindexSources(await loadSources());
        setUploads((current) => current.filter((upload) => upload.id !== uploadId));
      } catch (caught) {
        const message = caught instanceof SourceExtractionError
          ? caught.message
          : isQuotaExceededError(caught)
            ? "Browser storage is full. Remove a source or free space, then try again."
            : "This file could not be added.";
        setUploads((current) => current.map((upload) => (upload.id === uploadId ? { ...upload, error: message } : upload)));
      }
    }
  };

  const toggleSource = async (source: SourceRecord) => {
    await setSourceEnabled(source.id, !source.enabled);
    setSources((current) => current.map((item) => (item.id === source.id ? { ...item, enabled: !item.enabled } : item)));
  };

  const removeSource = async (source: SourceRecord) => {
    await deleteSource(source.id);
    setConfirmingDelete(undefined);
    await reindexSources(sources.filter((item) => item.id !== source.id));
  };

  const addToPage = async (message: ChatMessageRecord, index: number) => {
    const question = [...messages.slice(0, index)].reverse().find((item) => item.role === "user")?.content ?? "Study assistant";
    setAddStatus((current) => ({ ...current, [message.id]: "Adding…" }));
    // Notes on the receiving page that the answer cited become its recorded sources.
    const page = pagesRef.current.find((candidate) => candidate.id === activePageId);
    const sources = page ? await withContentHashes(citedPageSources(message.citations ?? [], page), page.objects) : [];
    const outcome = await onAddToPage({
      title: question.replace(/\s+/g, " ").trim(),
      body: answerForCanvas(message.content, message.citations ?? []),
      provider: message.provider ?? "unknown",
      model: message.model ?? "unknown",
      sources,
    });
    setAddStatus((current) => ({ ...current, [message.id]: outcome.ok ? "Added to the page" : outcome.message }));
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) {
      setTab("sources");
      void addFiles(event.dataTransfer.files);
    }
  };

  if (!open) {
    return (
      <button
        ref={orbRef}
        type="button"
        className="chat-orb"
        data-busy={Boolean(streaming)}
        onClick={() => setOpen(true)}
        aria-label="Open study assistant"
        title="Study assistant"
      >
        <OrbIcon />
      </button>
    );
  }

  const citationFor = (message: ChatMessageRecord, id: string) => message.citations?.find((citation) => citation.id === id);
  const sentIds = (message: ChatMessageRecord) => new Set((message.citations ?? []).map((citation) => citation.id));
  const liveIds = new Set(streaming?.passages.map((passage) => passage.id) ?? []);
  const disclosure = `Your question and up to 12 matching passages from ${enabledSourceIds.size} ${enabledSourceIds.size === 1 ? "source" : "sources"}${includeNotes ? " and your notebook pages" : ""} are sent to DeepSeek.`;

  return (
    <aside
      className="chat-dock"
      aria-label="Study assistant"
      onKeyDown={onPanelKeyDown}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={onDrop}
      data-dragging={dragging}
    >
      <header className="chat-dock__header">
        <div className="chat-dock__title">
          <span className="chat-dock__mark"><OrbIcon /></span>
          <strong>Study assistant</strong>
        </div>
        <div className="chat-dock__header-actions">
          {tab === "chat" && messages.length > 0 && !streaming && (
            confirmingClear
              ? <button type="button" className="chat-link chat-link--danger" onClick={() => { void clearChatMessages().then(() => { setMessages([]); setFailure(undefined); setConfirmingClear(false); }); }}>Clear chat?</button>
              : <button type="button" className="chat-link" onClick={() => setConfirmingClear(true)}>New chat</button>
          )}
          <button type="button" className="chat-icon-button" onClick={() => setOpen(false)} aria-label="Minimise study assistant" title="Minimise (Esc)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      <div className="chat-tabs" role="tablist" aria-label="Assistant views">
        <button type="button" role="tab" id="chat-tab-chat" aria-controls="chat-panel-chat" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>Chat</button>
        <button type="button" role="tab" id="chat-tab-sources" aria-controls="chat-panel-sources" aria-selected={tab === "sources"} onClick={() => setTab("sources")}>
          Sources{sources.length > 0 ? ` (${sources.length})` : ""}
        </button>
      </div>

      {loadError && <p className="chat-alert" role="alert">{loadError}</p>}

      {tab === "chat" && (
        <section className="chat-panel" id="chat-panel-chat" role="tabpanel" aria-labelledby="chat-tab-chat">
          <div className="chat-log" ref={logRef} aria-live="polite">
            {loaded && messages.length === 0 && !streaming && (
              <div className="chat-empty">
                <p><strong>Ask about your sources and notes.</strong></p>
                <p>Answers cite the passages they use. {sources.length === 0 ? "Add PDFs, Word or text files under Sources, or ask about your notebook pages." : ""}</p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => void send(suggestion)} disabled={!isOnline}>{suggestion}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => {
              const opened = activeCitation?.messageId === message.id ? citationFor(message, activeCitation.id) : undefined;
              return (
                <article key={message.id} className={`chat-message chat-message--${message.role}`}>
                  {message.role === "user"
                    ? <p>{message.content}</p>
                    : (
                      <>
                        <div className="chat-message__body">
                          <ChatMarkdown
                            text={message.content}
                            citationIds={sentIds(message)}
                            activeCitation={activeCitation?.messageId === message.id ? activeCitation.id : undefined}
                            onCite={(id) => setActiveCitation((current) => (current?.messageId === message.id && current.id === id ? undefined : { messageId: message.id, id }))}
                          />
                        </div>
                        {opened && (
                          <blockquote className="chat-passage">
                            <header>
                              <strong>{opened.id.slice(1)}. {opened.origin}</strong>
                              {opened.locator && <span>{opened.locator}</span>}
                            </header>
                            <p>{opened.text}</p>
                            {opened.pageId && pages.some((page) => page.id === opened.pageId) && (
                              <button type="button" className="chat-link" onClick={() => onOpenPage(opened.pageId!)}>Open this page</button>
                            )}
                          </blockquote>
                        )}
                        <footer className="chat-message__footer">
                          {message.incomplete && <span className="chat-tag">Stopped early</span>}
                          {(message.citations?.length ?? 0) > 0 && <span>{message.citations!.length} {message.citations!.length === 1 ? "source" : "sources"} cited</span>}
                          {!readOnly && (
                            <button type="button" className="chat-link" onClick={() => void addToPage(message, index)} disabled={addStatus[message.id] === "Adding…"}>
                              Add to page
                            </button>
                          )}
                          {addStatus[message.id] && <span role="status">{addStatus[message.id]}</span>}
                        </footer>
                      </>
                    )}
                </article>
              );
            })}

            {streaming && (
              <article className="chat-message chat-message--assistant" aria-busy="true">
                <div className="chat-message__body">
                  {streaming.text
                    ? <ChatMarkdown text={streaming.text} citationIds={liveIds} />
                    : <p className="chat-thinking">Reading {streaming.passages.length} {streaming.passages.length === 1 ? "passage" : "passages"}…</p>}
                </div>
              </article>
            )}

            {failure && (
              <div className="chat-alert" role="alert">
                <span>{failure.message}</span>
                <div>
                  {failure.retryable && <button type="button" onClick={() => void answer(failure.question, failure.history)} disabled={!isOnline}>Try again</button>}
                  <button type="button" onClick={() => setFailure(undefined)}>Dismiss</button>
                </div>
              </div>
            )}
          </div>

          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
            <label className="visually-hidden" htmlFor="chat-input">Ask the study assistant</label>
            <textarea
              id="chat-input"
              ref={composerRef}
              value={draft}
              rows={2}
              maxLength={4_000}
              placeholder={isOnline ? "Ask about your sources and notes…" : "Offline: asking needs a connection"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
            />
            {streaming
              ? <button type="button" className="chat-send chat-send--stop" onClick={stop}>Stop</button>
              : <button type="submit" className="chat-send" disabled={!draft.trim() || !isOnline}>Ask</button>}
          </form>
          <p className="chat-disclosure">{disclosure}</p>
        </section>
      )}

      {tab === "sources" && (
        <section className="chat-panel chat-sources" id="chat-panel-sources" role="tabpanel" aria-labelledby="chat-tab-sources">
          <div className="chat-dropzone">
            <p><strong>Add PDFs, Word (.docx), text or Markdown files.</strong></p>
            <p>Text is read on this device and kept in this browser. Only passages matching a question are sent.</p>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={readOnly}>Choose files</button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_SOURCE_TYPES}
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {readOnly && <p>This tab is read-only; add sources in the tab that is open for writing.</p>}
          </div>

          {uploads.map((upload) => (
            <div key={upload.id} className="chat-upload" data-error={Boolean(upload.error)} role={upload.error ? "alert" : "status"}>
              <span className="chat-upload__name">{upload.name}</span>
              {upload.error
                ? <><span>{upload.error}</span><button type="button" className="chat-link" onClick={() => setUploads((current) => current.filter((item) => item.id !== upload.id))}>Dismiss</button></>
                : <span>Reading{upload.progress !== undefined ? ` ${Math.round(upload.progress * 100)}%` : "…"}</span>}
            </div>
          ))}

          <label className="chat-toggle">
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(event) => { setIncludeNotes(event.target.checked); writeFlag(NOTES_KEY, event.target.checked); }}
            />
            <span>Use my notebook pages ({pages.length})</span>
          </label>

          {loaded && sources.length === 0 && uploads.length === 0 && <p className="chat-muted">No sources yet.</p>}
          <ul className="chat-source-list">
            {sources.map((source) => (
              <li key={source.id}>
                <label className="chat-toggle">
                  <input type="checkbox" checked={source.enabled} onChange={() => void toggleSource(source)} disabled={readOnly} />
                  <span className="chat-source__name">{source.name}</span>
                </label>
                <span className="chat-source__meta">
                  {KIND_LABELS[source.kind]} · {source.pageCount ? `${source.pageCount} pages · ` : ""}{formatBytes(source.size)} · {source.chunkCount} {source.chunkCount === 1 ? "passage" : "passages"}
                </span>
                {!readOnly && (
                  confirmingDelete === source.id
                    ? (
                      <span className="chat-source__actions">
                        <button type="button" className="chat-link chat-link--danger" onClick={() => void removeSource(source)}>Remove</button>
                        <button type="button" className="chat-link" onClick={() => setConfirmingDelete(undefined)}>Keep</button>
                      </span>
                    )
                    : <button type="button" className="chat-link" onClick={() => setConfirmingDelete(source.id)} aria-label={`Remove ${source.name}`}>Remove…</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {dragging && <div className="chat-drop-overlay" aria-hidden="true">Drop files to add them as sources</div>}
    </aside>
  );
}
