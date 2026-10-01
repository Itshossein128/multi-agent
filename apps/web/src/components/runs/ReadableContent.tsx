"use client";

import ReactMarkdown from "react-markdown";

/** Render agent/log text as readable prose — markdown becomes formatted content, not raw syntax. */
export function ReadableContent({ text }: { text: string }) {
  return (
    <div className="readable-md max-h-80 overflow-auto rounded-md bg-zinc-950/80 p-3 text-sm leading-relaxed text-zinc-200">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="mb-2 text-base font-semibold text-zinc-50">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold text-zinc-50">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 text-sm font-medium text-zinc-100">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-1 text-sm font-medium text-zinc-100">{children}</h4>,
          p: ({ children }) => <p className="mb-2 last:mb-0 text-sm text-zinc-200">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="pl-1 text-sm text-zinc-200">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
          em: ({ children }) => <em className="italic text-zinc-100">{children}</em>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return <code className="font-mono text-xs text-zinc-300">{children}</code>;
            }
            return (
              <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[0.85em] text-zinc-300">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded bg-zinc-900 p-2 font-mono text-xs text-zinc-300 last:mb-0 wrap-break-word">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-zinc-600 pl-3 text-sm text-zinc-400 last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-zinc-700" />,
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-left text-xs text-zinc-300">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-zinc-700 bg-zinc-900 px-2 py-1 font-medium text-zinc-100">{children}</th>,
          td: ({ children }) => <td className="border border-zinc-700 px-2 py-1">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
