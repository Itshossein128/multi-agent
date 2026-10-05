"use client";

import React, { useEffect, useState } from "react";
import { MessageSquare, Send, Bot, User, Trash2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { useStudioLocale } from "@/lib/useStudioLocale";
import type { BoardAgent } from "@/lib/taskStatus";

export interface TaskCommentItem {
  id: string;
  tenantId: string;
  taskId: string;
  authorId: string;
  authorType: "user" | "agent" | "system";
  content: string;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
}

interface TaskCommentsSectionProps {
  taskId: string;
  agents: BoardAgent[];
}

const translations = {
  en: {
    title: "Comments & Agent Mentions",
    commentSingular: "comment",
    commentPlural: "comments",
    mention: "Mention:",
    loading: "Loading comments...",
    empty: "No comments yet. Mention an agent to wake them up!",
    placeholder: "Leave a comment or type @agent to wake an agent...",
    post: "Post Comment",
    posting: "Posting...",
    deleteTitle: "Delete comment",
    loadError: "Failed to load comments",
    postError: "Failed to post comment",
    switchLang: "فارسی",
  },
  fa: {
    title: "یادداشت‌ها و فراخوانی عوامل",
    commentSingular: "یادداشت",
    commentPlural: "یادداشت",
    mention: "ارجاع به:",
    loading: "در حال بارگذاری یادداشت‌ها...",
    empty: "هنوز یادداشتی ثبت نشده است. با ذکر نام عامل آن را فراخوانی کنید!",
    placeholder: "یادداشتی بگذارید یا با @agent عاملی را فراخوانی کنید...",
    post: "ارسال یادداشت",
    posting: "در حال ارسال...",
    deleteTitle: "حذف یادداشت",
    loadError: "خطا در بارگذاری یادداشت‌ها",
    postError: "خطا در ارسال یادداشت",
    switchLang: "English",
  },
};

export function TaskCommentsSection({ taskId, agents }: TaskCommentsSectionProps) {
  const { locale, direction, toggleLocale } = useStudioLocale();
  const t = translations[locale];

  const [comments, setComments] = useState<TaskCommentItem[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/execution/studio/tasks/${encodeURIComponent(taskId)}/comments`);
      if (!res.ok) throw new Error(t.loadError);
      const data = await res.json();
      setComments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || t.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (taskId) {
      fetchComments();
    }
  }, [taskId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    try {
      setSubmitting(true);
      setError(null);
      const res = await fetch(`/api/execution/studio/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          authorType: "user",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t.postError);
      }

      setContent("");
      await fetchComments();
    } catch (err: any) {
      setError(err?.message || t.postError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      const res = await fetch(
        `/api/execution/studio/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: "DELETE",
        }
      );
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const insertMention = (agentName: string) => {
    setContent((prev) => `${prev ? prev + " " : ""}@${agentName} `);
  };

  return (
    <div
      dir={direction}
      className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-indigo-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            {t.title}
          </h4>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-500 font-mono">
            {comments.length} {comments.length === 1 ? t.commentSingular : t.commentPlural}
          </span>
          <button
            type="button"
            onClick={toggleLocale}
            className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-indigo-300 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60 cursor-pointer"
            title="Toggle English / Persian"
          >
            <Globe className="h-3 w-3" />
            <span>{t.switchLang}</span>
          </button>
        </div>
      </div>

      {/* Available Agents Quick Mention */}
      {agents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[10px] uppercase font-semibold text-zinc-500">{t.mention}</span>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => insertMention(agent.name || agent.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono bg-zinc-800/80 hover:bg-indigo-950 hover:text-indigo-300 border border-zinc-700/60 transition-colors text-zinc-300 cursor-pointer"
            >
              <Bot className="h-3 w-3 text-indigo-400" />
              @{agent.name || agent.id}
            </button>
          ))}
        </div>
      )}

      {/* Comments List */}
      <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
        {loading && comments.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-2">{t.loading}</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-zinc-500 italic py-2">{t.empty}</p>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2.5 space-y-1.5 transition-colors hover:border-zinc-700"
            >
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-medium text-zinc-300">
                  {comment.authorType === "agent" ? (
                    <Bot className="h-3.5 w-3.5 text-indigo-400" />
                  ) : (
                    <User className="h-3.5 w-3.5 text-emerald-400" />
                  )}
                  <span>{comment.authorId}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    ({comment.authorType})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(comment.id)}
                    className="text-zinc-600 hover:text-red-400 p-0.5 cursor-pointer"
                    title={t.deleteTitle}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <p
                className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap"
                dir="auto"
              >
                {comment.content}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Comment Input Form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t.placeholder}
          rows={2}
          dir="auto"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-hidden"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={submitting || !content.trim()}
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs cursor-pointer"
          >
            <Send className="h-3 w-3" />
            {submitting ? t.posting : t.post}
          </Button>
        </div>
      </form>
    </div>
  );
}
