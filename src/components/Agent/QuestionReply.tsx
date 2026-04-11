// 提问回复组件
// 功能：Agent 提出问题时显示回复输入框

import { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import { MessageCircle, Send } from "lucide-react";
import { replyQuestion } from "../../lib/tauri";

interface QuestionReplyProps {
  sessionId: string;
  question: string;
}

export function QuestionReply({ sessionId, question }: QuestionReplyProps) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await replyQuestion(sessionId, reply.trim());
      setReply("");
    } catch (err) {
      console.error("回复发送失败:", err);
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
    >
      {/* 问题标题 */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        marginBottom: 6,
        fontSize: 11,
        color: "#88c0d0",
        fontWeight: 500,
      }}>
        <MessageCircle size={12} />
        Waiting for reply
      </div>

      {/* 问题内容 */}
      <div style={{
        fontSize: 11,
        padding: "8px 10px",
        background: "#2e3440",
        borderRadius: 10,
        border: "1px solid #434c5e",
        marginBottom: 8,
        lineHeight: 1.6,
        color: "#d8dee9",
        maxHeight: 80,
        overflowY: "auto",
      }}>
        {question}
      </div>

      {/* 输入框 + 发送按钮 */}
      <div style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}>
        <input
          ref={inputRef}
          className="no-drag"
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your reply..."
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: 8,
            border: "1px solid #434c5e",
            background: "#2e3440",
            color: "#eceff4",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            outline: "none",
          }}
          onFocus={(e) => {
            (e.target as HTMLInputElement).style.borderColor = "#88c0d0";
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor = "#434c5e";
          }}
        />
        <motion.button
          className="no-drag"
          whileHover={{ scale: 1.05, filter: "brightness(1.2)" }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSend}
          disabled={!reply.trim() || sending}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            border: "none",
            background: reply.trim() ? "linear-gradient(135deg, #88c0d0, #81a1c1)" : "#3b4252",
            color: reply.trim() ? "#2e3440" : "#4c566a",
            cursor: reply.trim() && !sending ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          <Send size={11} />
        </motion.button>
      </div>
    </motion.div>
  );
}
