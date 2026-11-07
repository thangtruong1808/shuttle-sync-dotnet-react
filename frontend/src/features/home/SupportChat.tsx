import { type FormEvent, useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button, PickerInput, Spinner } from "../../components/ui";
import { apiFetch, AuthRequestError } from "../auth/authApi";
import { rememberCourtPromoLink } from "../venues/venueApi";
import { refreshUnpaidHolds } from "../profile/profileApi";
import { openingChoices, SupportChatActions, type SupportChatAction } from "./SupportChatCards";

type ChatMessage = { role: "user" | "assistant"; text: string; actions?: SupportChatAction[] };

function localIso(value = new Date()) {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function spokenClock(value: string) {
  const [hourText, minuteText = "00"] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || value.length === 0) return "";
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function englishDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const value = new Date(year, (month ?? 1) - 1, day);
  const weekday = value.toLocaleDateString("en-GB", { weekday: "long" });
  const monthName = value.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday}, ${day} ${monthName} ${year}`;
}

export function SupportChat({ venueName, venueSlug, date }: { venueName: string; venueSlug: string; date: string }) {
  const [open, setOpen] = useState(false);
  const [otherDate, setOtherDate] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [replyMode, setReplyMode] = useState<"text" | "voice">("text");
  const replyModeRef = useRef(replyMode);
  replyModeRef.current = replyMode;
  const [draft, setDraft] = useState("");
  const [pickedTime, setPickedTime] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sendingRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const threadRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const last = messages[messages.length - 1];
  const asksStart = last?.role === "assistant" && /type the time you would like to start/i.test(last.text);

  useEffect(() => {
    window.speechSynthesis?.getVoices();
    const loadVoices = () => window.speechSynthesis?.getVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
      stopRecording();
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages, sending, notice]);

  useEffect(() => {
    if (asksStart && mode === "text") draftRef.current?.focus();
  }, [asksStart, mode, messages.length]);

  function resetChat() {
    if (sendingRef.current) return;
    stopRecording();
    stopSpeaking();
    setMessages([]);
    setDraft("");
    setPickedTime("");
    setNotice(null);
    setOtherDate("");
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  function speak(text: string) {
    if (!window.speechSynthesis) return;
    const spoken = text.replace(/\p{Extended_Pictographic}/gu, "").replace(/[\uFE0F\u200D]/g, "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!spoken) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = "en-AU";
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => item.lang.toLowerCase().startsWith("en-au")) ?? voices.find((item) => item.lang.toLowerCase().startsWith("en"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setNotice("This browser could not play the voice. The answer is still written above.");
    };
    setSpeaking(true);
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder?.stream.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }

  async function ask(next: ChatMessage[], audio?: { audioBase64: string; mimeType: string }) {
    setNotice(null);
    sendingRef.current = true;
    setSending(true);
    try {
      await apiFetch("/api/me");
      const response = await apiFetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueSlug,
          date,
          messages: next.slice(-14).map((message) => ({ role: message.role, text: message.text })),
          audioBase64: audio?.audioBase64,
          mimeType: audio?.mimeType,
        }),
      });
      const body = (await response.json().catch(() => null)) as { reply?: string; transcript?: string; actions?: SupportChatAction[]; errors?: { form?: string[] } } | null;
      if (!response.ok) {
        setNotice(body?.errors?.form?.[0] ?? "The agent could not answer just now.");
        return;
      }
      const reply = body?.reply ?? "I could not answer that.";
      const heard = body?.transcript?.trim();
      const answer: ChatMessage = { role: "assistant", text: reply, actions: body?.actions ?? [] };
      rememberCourtPromoLink(answer.actions ?? []);
      if (/place is held/i.test(reply) || (answer.actions ?? []).some((action) => action.kind === "my_bookings_link" || action.kind === "stripe_checkout" || action.socialId)) refreshUnpaidHolds();
      setMessages(audio
        ? [...messagesRef.current, ...(heard ? [{ role: "user" as const, text: heard }] : []), answer]
        : [...next, answer]);
      if (replyModeRef.current === "voice" && body?.reply) speak(body.reply);
    } catch (reason) {
      setNotice(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "The agent could not answer just now." : "The agent could not answer just now.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", text }];
    setMessages(next);
    setDraft("");
    setPickedTime("");
    stopSpeaking();
    await ask(next);
  }

  function sendPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;
    const next: ChatMessage[] = [...messagesRef.current, { role: "user", text: trimmed }];
    setMessages(next);
    stopSpeaking();
    void ask(next);
  }

  async function finishRecording() {
    const recorder = recorderRef.current;
    if (!recorder || sendingRef.current) return;
    const mimeType = recorder.mimeType || "audio/webm";
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeType }));
      stopRecording();
    });
    if (blob.size < 800) {
      setNotice("I could not hear that. Move closer and try again.");
      return;
    }
    const audioBase64 = await blobToBase64(blob);
    stopSpeaking();
    await ask(messagesRef.current, { audioBase64, mimeType });
  }

  async function onVoice() {
    if (sendingRef.current) return;
    if (recorderRef.current) {
      await finishRecording();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setNotice("Voice needs Chrome or Edge so the microphone can be used.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setNotice(null);
      window.setTimeout(() => {
        if (recorderRef.current === recorder) void finishRecording();
      }, 20000);
    } catch {
      setNotice("Allow the microphone for this site, then try again.");
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 flex max-h-[calc(100dvh-1.5rem)] w-[min(36rem,calc(100vw-1.5rem))] flex-col items-end gap-2.5 sm:bottom-4 sm:right-4 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(36rem,calc(100vw-2rem))] sm:gap-3">
      {open ? (
        <section className="pointer-events-auto flex h-[min(40rem,calc(100dvh-5.25rem))] min-h-0 w-full flex-col overflow-y-auto rounded-3xl border border-border bg-surface p-3 shadow-pop sm:h-[min(40rem,calc(100dvh-6.5rem))] sm:overflow-hidden sm:p-4" aria-label="AI booking agent">
          <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-canvas text-accent-text ring-1 ring-accent-text/60 sm:h-11 sm:w-11">
              <AssistantMark className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base leading-tight text-fg sm:text-lg">Court Agent</p>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-text">AI booking</p>
            </div>
            <Button type="button" size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />} disabled={sending} onClick={resetChat}>Refresh</Button>
          </div>
          <div className="mt-2.5 grid shrink-0 gap-1.5 min-[380px]:grid-cols-2 sm:mt-3 sm:gap-2">
            <ChatChoice
              label="You"
              value={mode}
              onText={() => { stopRecording(); setMode("text"); }}
              onVoice={() => { setMode("voice"); setReplyMode("voice"); }}
            />
            <ChatChoice
              label="Reply"
              value={replyMode}
              onText={() => { stopSpeaking(); setReplyMode("text"); }}
              onVoice={() => setReplyMode("voice")}
            />
          </div>
          <p className="mt-2 shrink-0 truncate text-xs text-fg-muted sm:mt-3 sm:text-sm">Help for {venueName}.</p>
          <div ref={threadRef} className="mt-2.5 min-h-[8.5rem] flex-1 space-y-3 overflow-y-auto sm:mt-3 sm:min-h-0" data-chat-thread>
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-fg-muted">Choose a starting point, or type your own question.</p>
                <SupportChatActions actions={openingChoices} sending={sending} showReplies onPrompt={sendPrompt} onClose={() => setOpen(false)} />
                <div className="rounded-2xl border border-border bg-inset p-3">
                  <label className="block text-sm font-semibold text-fg" htmlFor="chat-other-date">Another date</label>
                  <p className="mt-1 text-sm text-fg-muted">Pick a day further ahead than today or tomorrow.</p>
                  <PickerInput id="chat-other-date" type="date" min={localIso()} className="mt-2 w-full" value={otherDate} disabled={sending} onChange={(event) => setOtherDate(event.target.value)} />
                  <Button type="button" size="sm" className="mt-2" loading={sending} disabled={sending || otherDate.length === 0} onClick={() => sendPrompt(`Which courts are free on ${englishDate(otherDate)}?`)}>Courts on this date</Button>
                </div>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div key={index} className={message.role === "user" ? "flex justify-end" : "flex items-end gap-2"}>
                {message.role === "assistant" ? (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-canvas text-accent-text ring-1 ring-accent-text/50">
                    <AssistantMark className="h-4 w-4" />
                  </span>
                ) : null}
                <div className="flex max-w-[85%] flex-col gap-2">
                  <p className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${message.role === "user" ? "bg-accent/15 text-fg" : "bg-surface-2 text-fg"}`}>
                    {message.text}
                  </p>
                  {message.role === "assistant" ? <SupportChatActions actions={message.actions} sending={sending} showReplies={index === messages.length - 1} onPrompt={sendPrompt} onClose={() => setOpen(false)} /> : null}
                </div>
              </div>
            ))}
            {sending ? (
              <div className="flex items-end gap-2" role="status" aria-live="polite">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-canvas text-accent-text ring-1 ring-accent-text/50">
                  <AssistantMark className="h-4 w-4" />
                </span>
                <p className="inline-flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm text-fg-muted">
                  <Sparkles className="h-4 w-4 text-accent-text motion-safe:animate-pulse" aria-hidden="true" />
                  Looking that up
                  <Spinner className="h-4 w-4" />
                </p>
              </div>
            ) : null}
          </div>
          {notice ? <p className="mt-2 text-sm text-fg" role="alert">{notice}</p> : null}
          {asksStart ? (
            <div className="mt-3 rounded-2xl border border-border bg-inset p-3">
              <label className="block text-sm font-semibold text-fg" htmlFor="chat-start-time">Pick a start time</label>
              <p className="mt-1 text-sm text-fg-muted">{mode === "text" ? "Optional. You can also type the time below." : "Optional. You can also say the time."}</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <PickerInput
                  id="chat-start-time"
                  type="time"
                  className="w-full sm:max-w-44"
                  value={pickedTime}
                  disabled={sending}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPickedTime(value);
                    const spoken = spokenClock(value);
                    if (spoken && mode === "text") setDraft(spoken);
                  }}
                />
                {mode === "voice" ? (
                  <Button type="button" size="sm" className="w-full sm:w-auto" loading={sending} disabled={sending || spokenClock(pickedTime).length === 0} onClick={() => sendPrompt(`Start at ${spokenClock(pickedTime)}`)}>Use this time</Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {mode === "text" ? (
            <form className="mt-2.5 flex shrink-0 items-end gap-2 sm:mt-3" onSubmit={onSend}>
              <textarea
                ref={draftRef}
                rows={2}
                value={draft}
                disabled={sending}
                placeholder={asksStart ? "Type a start time, for example 6:00 PM" : "Ask about a court or a time"}
                aria-label="Question"
                className="min-h-[3.5rem] w-full resize-none rounded-2xl border border-border bg-surface-2 px-3 py-2 text-base text-fg disabled:opacity-60 sm:min-h-[4.75rem] sm:text-sm"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <Button type="submit" className="shrink-0" icon={<Send className="h-4 w-4" aria-hidden="true" />} loading={sending} disabled={sending || draft.trim().length === 0}>Send</Button>
            </form>
          ) : (
            <div className="mt-2.5 flex shrink-0 flex-col gap-2 sm:mt-3 sm:flex-row sm:items-center">
              <Button type="button" className="w-full sm:w-auto" icon={recording ? undefined : <Mic className="h-4 w-4" aria-hidden="true" />} loading={sending} disabled={sending} onClick={() => void onVoice()}>
                {recording ? "Send voice" : "Tap to talk"}
              </Button>
            </div>
          )}
          {speaking ? <button type="button" className="mt-2 inline-flex min-h-10 items-center self-start rounded-lg px-2 py-1 text-sm font-semibold text-accent-text hover:bg-fg/5" onClick={stopSpeaking}>Stop speaking</button> : null}
          <p className="mt-1.5 shrink-0 text-xs text-fg-muted sm:mt-2">{asksStart ? (mode === "text" ? "Pick a time or type one, then send." : "Pick a time, or tap to talk.") : mode === "text" ? "Enter starts a new line." : recording ? "Listening… tap Send voice when you finish. It stops after 20 seconds." : "Tap to talk, then tap again to send."}{replyMode === "voice" ? " Replies are read aloud." : ""}</p>
        </section>
      ) : null}
      <button
        type="button"
        className="pointer-events-auto inline-flex min-h-11 items-center gap-2.5 rounded-full bg-accent py-1.5 pl-2 pr-4 text-sm font-semibold text-accent-fg shadow-pop"
        aria-expanded={open}
        aria-label={open ? "Close the booking agent" : "Open the AI booking agent"}
        onClick={() => {
          if (open) {
            stopRecording();
            stopSpeaking();
            setOpen(false);
            return;
          }
          setOpen(true);
          void apiFetch("/api/auth/refresh", { method: "POST" }).catch(() => undefined);
        }}
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-canvas text-accent-text">
          <AssistantMark className="h-5 w-5" />
        </span>
        {open ? "Close" : "AI Agent"}
      </button>
    </div>
  );
}

function ChatChoice({ label, value, onText, onVoice }: { label: string; value: "text" | "voice"; onText: () => void; onVoice: () => void }) {
  return (
    <div className="flex items-center justify-between gap-1.5 rounded-full bg-surface-2 p-1 pl-2.5 sm:gap-2 sm:pl-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-muted sm:text-xs">{label}</span>
      <div className="grid grid-cols-2 rounded-full text-xs font-semibold" role="group" aria-label={label}>
        <button type="button" className={`min-h-8 rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5 ${value === "text" ? "bg-accent text-accent-fg" : "text-fg"}`} aria-pressed={value === "text"} onClick={onText}>Text</button>
        <button type="button" className={`min-h-8 rounded-full px-2.5 py-1 sm:px-3 sm:py-1.5 ${value === "voice" ? "bg-accent text-accent-fg" : "text-fg"}`} aria-pressed={value === "voice"} onClick={onVoice}>Voice</button>
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function AssistantMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path className="fill-current" d="M16 2.2c.7 0 1.3.5 1.5 1.1l2.4 7.1 7.1 2.4c.6.2 1.1.8 1.1 1.5s-.5 1.3-1.1 1.5l-7.1 2.4-2.4 7.1c-.2.6-.8 1.1-1.5 1.1s-1.3-.5-1.5-1.1l-2.4-7.1-7.1-2.4C3.8 16 3.3 15.4 3.3 14.7s.5-1.3 1.1-1.5l7.1-2.4 2.4-7.1c.2-.6.8-1.1 1.5-1.1Z" />
      <path className="fill-current" d="M25.4 2.6c.4 0 .7.3.8.6l.9 2.6 2.6.9c.3.1.6.4.6.8s-.3.7-.6.8l-2.6.9-.9 2.6c-.1.3-.4.6-.8.6s-.7-.3-.8-.6l-.9-2.6-2.6-.9c-.3-.1-.6-.4-.6-.8s.3-.7.6-.8l2.6-.9.9-2.6c.1-.3.4-.6.8-.6Z" />
    </svg>
  );
}
