const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type ApiError = { code: string; message: string; details?: unknown };

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("trao_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("trao_token", token);
  else localStorage.removeItem("trao_token");
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.json !== undefined) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: ApiError }).error ?? {
      code: "HTTP",
      message: res.statusText || "Request failed",
    };
    throw Object.assign(new Error(err.message), err);
  }
  return data as T;
}

export type KitRecord = {
  _id: string;
  title: string;
  status: "queued" | "running" | "ready" | "failed";
  days: number;
  companyUrl: string;
  progress: Array<{ step: string; status: string; detail?: string; at: string }>;
  error?: { code: string; message: string } | null;
  kit?: KitPayload | null;
  meta?: {
    questionOrigins?: Record<string, string>;
    flashcardOrigins?: Record<string, string>;
    pinnedQuestionIds?: string[];
    pinnedFlashcardIds?: string[];
  };
  practice?: Array<{
    flashcardId: string;
    confidence: number;
    seenCount: number;
    lastSeenAt?: string;
  }>;
  updatedAt?: string;
};

export type KitPayload = {
  source: {
    company: string;
    company_url: string;
    role: string;
    location: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
  };
  company_brief: { summary: string; what_they_do: string; sources: string[] };
  role: {
    title: string;
    seniority: string;
    responsibilities: string[];
    requirements: Array<{
      id: string;
      text: string;
      kind: string;
      priority: string;
    }>;
  };
  questions: Array<{
    id: string;
    requirement_ids: string[];
    category: string;
    prompt: string;
    answer_outline: string;
    difficulty: number;
  }>;
  flashcards: Array<{
    id: string;
    front: string;
    back: string;
    requirement_ids: string[];
  }>;
  schedule: {
    days_available: number;
    days: Array<{ day: number; focus: string; question_ids: string[]; minutes: number }>;
  };
  coverage: { uncovered_requirement_ids: string[]; passes: number };
};
