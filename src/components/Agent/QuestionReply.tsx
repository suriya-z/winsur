// Question / optional message → paste into agent terminal

import { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import { ChevronDown, Send } from "lucide-react";
import { replyQuestion } from "../../lib/bridge";

interface QuestionReplyProps {
  sessionId: string;
  question: string;
  lastReply?: string | null;
  /** Optional free-chat vs required agent question */
  optional?: boolean;
  onClose?: () => void;
}

function ReplyPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return (
    <div style={{ marginBottom: "var(--space-2)" }}>
      <button
        type="button"
        className="no-drag"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          width: "100%",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-secondary)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--type-body)",
          fontWeight: 400,
          lineHeight: 1.4,
        }}
      >
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {oneLine}
        </span>
      </button>
      {open && (
        <div
          className="reply-scroll"
          style={{
            marginTop: "var(--space-1)",
            maxHeight: 160,
            overflowY: "auto",
            padding: "8px 10px",
            background: "var(--bg-inset)",
            borderRadius: 10,
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            fontSize: "var(--type-body)",
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            userSelect: "text",
            WebkitUserSelect: "text",
            textWrap: "pretty",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

export function QuestionReply({
  sessionId,
  question,
  lastReply,
  optional = false,
  onClose,
}: QuestionReplyProps) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sentOk, setSentOk] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!optional) inputRef.current?.focus();
  }, [optional]);

  const handleSend = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    setError("");
    setSentOk(false);
    try {
      const res = await replyQuestion(sessionId, reply.trim());
      const ok = typeof res === "boolean" ? res : !!res?.ok;
      const detail = typeof res === "object" && res ? res.detail || "" : "";
      if (ok) {
        setSentOk(true);
        setReply("");
        if (optional) {
          setTimeout(() => onClose?.(), 900);
        }
      } else {
        // Never show green "sent" unless backend ok:true
        setSentOk(false);
        setError(
          detail
            ? `Not delivered: ${detail.slice(0, 220)}`
            : "Not delivered. Keep the Grok/agent terminal open and visible, then try again."
        );
      }
    } catch (err) {
      console.error("reply failed:", err);
      setError(
        "Send failed — fully quit Winsur, then run npm start (or reinstall 0.1.1) so the new main process loads."
      );
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      style={{ marginTop: 10 }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!optional && (
        <div
          style={{
            marginBottom: "var(--space-2)",
            fontSize: "var(--type-meta)",
            color: "var(--accent-blue)",
            fontWeight: 600,
          }}
        >
          Agent needs a response
        </div>
      )}

      {!optional && question && (
        <div
          className="reply-scroll"
          style={{
            fontSize: "var(--type-body)",
            padding: "8px 10px",
            background: "var(--bg-inset)",
            borderRadius: 10,
            border: "1px solid var(--border-default)",
            marginBottom: "var(--space-2)",
            lineHeight: 1.45,
            color: "var(--text-secondary)",
            maxHeight: 160,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            userSelect: "text",
            WebkitUserSelect: "text",
          }}
        >
          {question}
        </div>
      )}

      {optional && lastReply?.trim() && <ReplyPreview text={lastReply.trim()} />}

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          ref={inputRef}
          className="no-drag"
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={optional ? "Reply to agent" : "Type your answer..."}
          disabled={sending}
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: 8,
            border: "1px solid var(--border-default)",
            background: "var(--bg-inset)",
            color: "var(--text-primary)",
            fontSize: "var(--type-body)",
            fontFamily: "var(--font-sans)",
            outline: "none",
          }}
          onFocus={(e) => {
            (e.target as HTMLInputElement).style.borderColor = "rgba(244,244,245,0.28)";
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.09)";
          }}
        />
        <motion.button
          className="no-drag"
          whileHover={{ scale: 1.04, filter: "brightness(1.06)" }}
          whileTap={{ scale: 0.96 }}
          onClick={handleSend}
          disabled={!reply.trim() || sending}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            border: "none",
            background: reply.trim() ? "var(--text-primary)" : "var(--bg-elevated)",
            color: reply.trim() ? "#0a0a0a" : "var(--text-muted)",
            cursor: reply.trim() && !sending ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
            opacity: sending ? 0.6 : 1,
          }}
        >
          <Send size={11} />
          {sending ? "…" : "Send"}
        </motion.button>
      </div>

      {error && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--accent-red)", lineHeight: 1.4 }}>
          {error}
        </div>
      )}
      {sentOk && !error && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--accent-green)", lineHeight: 1.4 }}>
          Sent to agent terminal.
        </div>
      )}
    </motion.div>
  );
}
