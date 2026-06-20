const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function* groqStream(
  messages: GroqMessage[],
  options?: { model?: string; max_tokens?: number; signal?: AbortSignal }
): AsyncGenerator<string> {
  const key = import.meta.env.VITE_GROQ_API_KEY as string;
  if (!key) throw new Error("VITE_GROQ_API_KEY is not set in .env");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    signal: options?.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: options?.model ?? "llama-3.3-70b-versatile",
      stream: true,
      max_tokens: options?.max_tokens ?? 150,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq ${res.status}: ${body}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        const delta: string = parsed.choices?.[0]?.delta?.content ?? "";
        if (delta) yield delta;
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}
