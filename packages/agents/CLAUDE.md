# @redflag/agents

Agent pipeline — pure async functions for each step of contract analysis.

## What's Here (Planned)

- `src/` — Agent functions (gate, parse, risk, rewrite, summary)
- `prompts/` — System prompts, one file per agent

## Pipeline

```
Upload → [Relevance Gate] → [Parse Agent] → [Risk Agent + RAG] → [Rewrite Agent] → [Summary Agent]
```

## Rules

- Agents are **pure async functions** — no classes, no state. Input → output.
- Every Claude response must be validated against a Zod schema from `@redflag/shared`
- Document text is **untrusted input** — system prompts must instruct Claude to analyze objectively
- RAG vector search is called from `@redflag/db`, not implemented here
- Claude models: Haiku for relevance gate, Sonnet for all other agents
