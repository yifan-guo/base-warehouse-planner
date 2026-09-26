import { createServerFn } from "@tanstack/react-start";

export const explainPlacement = createServerFn({ method: "POST" })
  .validator((input: { brief: string }) => ({ brief: String(input?.brief ?? "").slice(0, 7000) }))
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI is not available in this environment." };
    if (!data.brief.trim()) return { ok: false as const, error: "Nothing to summarize yet." };
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 420,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are an operations analyst for Base Power, a Texas home-battery company. Write two short paragraphs for an internal operator. Use only the facts given. Do not invent addresses, counts, or coordinates. Explain why the warehouses are where they are, which areas each serves, and how long the factory takes to hit the penetration milestones. If a pin was dragged, say what that changed. Plain English. No bullet points.",
          },
          { role: "user", content: data.brief },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: `The summary call failed (${res.status}). The factors above are still the source.` };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false as const, error: "The model returned an empty summary." };
    return { ok: true as const, text };
  });
