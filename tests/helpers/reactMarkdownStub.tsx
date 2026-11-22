import React from "react";

export default function ReactMarkdownStub({ children }: { children?: React.ReactNode }) {
  return React.createElement("div", { "data-testid": "markdown-content" }, children);
}
