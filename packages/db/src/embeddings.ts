import { VOYAGE_DIMENSIONS } from "@redflag/shared";

type InputType = "document" | "query";

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
  usage: { total_tokens: number };
}

interface VoyageErrorResponse {
  detail: string;
}

function getApiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    throw new Error("VOYAGE_API_KEY environment variable is required");
  }
  return key;
}

async function callVoyageApi(texts: string[], inputType: InputType): Promise<number[][]> {
  const apiKey = getApiKey();

  const body = JSON.stringify({
    input: texts,
    model: "voyage-law-2",
    input_type: inputType,
  });

  let lastError: Error | null = null;

  // Try up to 2 times (initial + 1 retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({
          detail: response.statusText,
        }))) as VoyageErrorResponse;
        throw new Error(`Voyage API error (${response.status}): ${errorBody.detail}`);
      }

      const result = (await response.json()) as VoyageEmbeddingResponse;

      // Validate response shape
      if (!result.data || !Array.isArray(result.data)) {
        throw new Error("Voyage API returned unexpected response shape");
      }

      const embeddings = result.data.map((d) => d.embedding);

      // Validate dimensions
      for (const embedding of embeddings) {
        if (embedding.length !== VOYAGE_DIMENSIONS) {
          throw new Error(`Expected ${VOYAGE_DIMENSIONS} dimensions, got ${embedding.length}`);
        }
      }

      return embeddings;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Voyage API call failed");
}

/**
 * Embed a single text string.
 * @param text - Text to embed
 * @param inputType - "document" for knowledge base entries, "query" for clause search
 * @returns 1024-dimensional embedding vector
 */
export async function embedText(text: string, inputType: InputType): Promise<number[]> {
  const results = await callVoyageApi([text], inputType);
  const first = results[0];
  if (!first) {
    throw new Error("Voyage API returned empty results");
  }
  return first;
}

/**
 * Embed multiple texts in a single batch call.
 * Voyage API supports up to 128 texts per call.
 * @param texts - Array of texts to embed
 * @param inputType - "document" for knowledge base entries, "query" for clause search
 * @returns Array of 1024-dimensional embedding vectors
 */
export async function embedTexts(texts: string[], inputType: InputType): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (texts.length > 128) {
    throw new Error(`Voyage API supports max 128 texts per batch, got ${texts.length}`);
  }

  return callVoyageApi(texts, inputType);
}
