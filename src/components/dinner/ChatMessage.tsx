"use client";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export function ChatMessage({
  children,
  own = false,
  fresh = false,
  label,
  status,
}: {
  children: ReactNode;
  own?: boolean;
  fresh?: boolean;
  label?: string;
  status?: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.article
      aria-label={label}
      className={`dinner-message chat-message${own ? " is-own" : " is-incoming"}`}
      initial={fresh && !reduce ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
      {status && <div className="chat-message-status" role="status">{status}</div>}
    </motion.article>
  );
}
