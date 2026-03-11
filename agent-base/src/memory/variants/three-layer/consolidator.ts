/**
 * GPT-5 consolidation for the 3-layer memory architecture.
 *
 * After each agent turn, extracts facts from the exchange and routes them
 * to the correct layer/file per the checkpoint protocol.
 *
 * Uses Claude Haiku via the Anthropic API for fast, cheap structured extraction.
 */

import { z } from "zod";

export interface ExtractedFact {
  content: string;
  destination: { layer: "L1" | "L2" | "L3"; file: string };
  action: "append" | "replace-section";
  section?: string;
}

export interface TrimSuggestion {
  file: string;
  contentToRemove: string;
  moveTo: string;
}

export interface ConsolidationResult {
  facts: ExtractedFact[];
  trimSuggestions: TrimSuggestion[];
}

const EMPTY_RESULT: ConsolidationResult = { facts: [], trimSuggestions: [] };

const ExtractedFactSchema = z.object({
  content: z.string(),
  destination: z.object({
    layer: z.enum(["L1", "L2", "L3"]),
    file: z.string(),
  }),
  action: z.enum(["append", "replace-section"]),
  section: z.string().nullable().optional(),
});

const TrimSuggestionSchema = z.object({
  file: z.string(),
  contentToRemove: z.string(),
  moveTo: z.string(),
});

const ConsolidationResultSchema = z.object({
  facts: z.array(ExtractedFactSchema),
  trimSuggestions: z.array(TrimSuggestionSchema),
});

const CONSOLIDATION_PROMPT = `You are a memory consolidation engine for a 3-layer agent memory system.

Given a user message, agent response, and current L1 file state, extract facts that should be persisted and route them to the correct destination.

## Routing Table

| Content Type | Destination |
|---|---|
| Behavioral rule / operational instruction | L1: AGENTS.md |
| Tool command or workaround | L1: TOOLS.md |
| Communication or preference change | L1: USER.md |
| Active state (what's live right now) | L1: MEMORY.md |
| Completed work / decisions / history | L2: memory/YYYY-MM-DD.md (use today's date) |
| Domain knowledge (reusable facts) | L2: memory/[topic].md |
| Deep reference material | L3: reference/[topic].md |

## Rules

1. Only extract facts that are worth remembering across sessions.
2. Skip trivial exchanges (greetings, acknowledgments, simple Q&A with no lasting value).
3. For L1 files, prefer "replace-section" with a section name when updating existing content.
4. For L2/L3 files, use "append" to add new entries.
5. Breadcrumb entries in L2 topic files should be one line each, ending with: -> Deep dive: reference/[topic].md (only if L3 content exists).
6. Keep fact content concise - one line for L1/L2, paragraphs only for L3.
7. Use kebab-case for new topic filenames (e.g., memory/api-design.md).

## Trim Suggestions

If any L1 file content looks stale, completed, or overly detailed for L1, suggest moving it down:
- Completed work -> L2 daily note
- Detailed specs -> L3 reference with L2 breadcrumb
- Old workarounds -> archive or remove

Return a JSON object with this exact structure:
{
  "facts": [
    {
      "content": "the fact text to write",
      "destination": { "layer": "L1" | "L2" | "L3", "file": "filename.md" },
      "action": "append" | "replace-section",
      "section": "Section Name (only for replace-section)"
    }
  ],
  "trimSuggestions": [
    {
      "file": "source file",
      "contentToRemove": "text to remove from source",
      "moveTo": "destination file path"
    }
  ]
}

If nothing worth persisting, return: { "facts": [], "trimSuggestions": [] }

Respond with ONLY the JSON object. No markdown fences, no explanation.`;

/**
 * Call Claude Haiku to extract facts and routing from an exchange.
 * On any failure, returns empty result (never throws).
 */
export async function consolidateWithLLM(
  userMessage: string,
  agentResponse: string,
  currentL1State: Record<string, string>,
  existingBreadcrumbs: string[],
  today: string,
): Promise<ConsolidationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[three-layer-consolidator] ANTHROPIC_API_KEY not set, skipping consolidation");
    return EMPTY_RESULT;
  }

  const l1Summary = Object.entries(currentL1State)
    .map(([file, content]) => `### ${file}\n${content}`)
    .join("\n\n");

  const breadcrumbSummary = existingBreadcrumbs.length > 0
    ? `\n\nExisting breadcrumb files in memory/:\n${existingBreadcrumbs.join(", ")}`
    : "";

  const userContent = `Today's date: ${today}

## Current L1 State

${l1Summary}${breadcrumbSummary}

## Exchange to Consolidate

**User:** ${userMessage}

**Agent:** ${agentResponse}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        temperature: 0,
        system: CONSOLIDATION_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[three-layer-consolidator] API error ${response.status}: ${body}`);
      return EMPTY_RESULT;
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock?.text) {
      console.error("[three-layer-consolidator] No text in API response");
      return EMPTY_RESULT;
    }

    let jsonText = textBlock.text.trim();
    const fenceMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    const validated = ConsolidationResultSchema.parse(parsed);
    return validated;
  } catch (err) {
    console.error("[three-layer-consolidator] Consolidation failed:", err);
    return EMPTY_RESULT;
  }
}
