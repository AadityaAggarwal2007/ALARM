#!/usr/bin/env node
/**
 * Discipline MCP server.
 *
 * Exposes the planner to any MCP-capable client — Claude Code, Claude Desktop,
 * Cursor, and anything else that speaks the protocol. It is a thin shell over
 * the HTTP API rather than a second implementation: the same validation, the
 * same recurrence rules, one source of truth.
 *
 * Deliberately four tools. A small, sharply described surface is answered
 * correctly far more often than a large one, and the whole point here is to
 * get a schedule built in one call instead of forty.
 *
 *   DISCIPLINE_URL    https://alarm.axonagent.online  (default)
 *   DISCIPLINE_TOKEN  a token from Settings → Agent access
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.DISCIPLINE_URL || "https://alarm.axonagent.online").replace(/\/$/, "");
const TOKEN = process.env.DISCIPLINE_TOKEN;

if (!TOKEN) {
  console.error("DISCIPLINE_TOKEN is not set. Create one in Settings → Agent access.");
  process.exit(1);
}

async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { ok: false, error: `Non-JSON response (${res.status}): ${text.slice(0, 200)}` };
  }
  return { status: res.status, body };
}

const json = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const server = new McpServer({ name: "discipline", version: "1.0.0" });

server.registerTool(
  "get_schedule",
  {
    title: "Get schedule and context",
    description:
      "Everything needed to reason about the schedule in one call: today's date and timezone, categories and subcategories, every block in a window (with its enforcement settings and how late it was actually started), repeating rules, goals, and the inbox. Call this first. Set analytics for the discipline summary — how many enforced blocks were kept, average lateness — instead of a second call.",
    inputSchema: {
      from: z.string().optional().describe('Start date "YYYY-MM-DD". Defaults to today.'),
      days: z.number().optional().describe("Window length in days. Default 14, max 120."),
      analytics: z.boolean().optional().describe("Include the discipline and time-use summary."),
    },
  },
  async ({ from, days, analytics }) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (days) p.set("days", String(days));
    if (analytics) p.set("analytics", "1");
    const { body } = await call(`/api/ai/context?${p}`);
    return json(body);
  }
);

server.registerTool(
  "apply_plan",
  {
    title: "Create, change or remove blocks",
    description:
      "The single write tool. Send every intent as one plan; do not loop one call per block. " +
      "A whole term of classes is one `schedule` op with `repeat`, and \"make the Friday ones vibrate\" is one `update` op with a weekday selector. " +
      "The plan is validated in full before anything is written, so it cannot half-apply. " +
      "IMPORTANT: nothing repeats unless you pass `repeat`, and update/delete never rewrite a repeating rule unless you pass `scope`. " +
      "If a selector hits rule-generated blocks without a scope the call is refused with `needsScope` and nothing changes — put that question to the user rather than guessing. " +
      "Times are local wall-clock: \"16:00-18:00\", never ISO or UTC. " +
      "Call describe_api for the full op reference.",
    inputSchema: {
      ops: z
        .array(z.record(z.any()))
        .describe(
          'Operations. Each has "op": "schedule" | "update" | "delete" | "goal". ' +
            'Example: [{"op":"schedule","key":"physics","title":"Physics","category":"Study","time":"16:00-18:00","repeat":{"weekdays":["MONDAY","WEDNESDAY"],"until":"2026-12-15"},"enforce":{"mode":"SIREN","difficulty":"medium","streak":3}}]'
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("Preview the diff without writing. Use when the user should confirm first."),
    },
  },
  async ({ ops, dryRun }) => {
    const { body } = await call("/api/ai/apply", {
      method: "POST",
      body: JSON.stringify({ ops, dryRun: dryRun === true }),
    });
    return json(body);
  }
);

server.registerTool(
  "get_stats",
  {
    title: "Discipline and time-use statistics",
    description:
      "How time was actually spent and how well enforced blocks were kept: hours by category, completion rate, share of enforced blocks honoured, average and worst lateness, and how many were ignored outright.",
    inputSchema: {
      preset: z
        .enum(["WEEK", "MONTH", "HALF_YEAR", "YEAR"])
        .optional()
        .describe("Period. Default WEEK."),
    },
  },
  async ({ preset }) => {
    const { body } = await call(`/api/ai/query?preset=${preset || "WEEK"}`);
    return json(body);
  }
);

server.registerTool(
  "describe_api",
  {
    title: "Full operation reference",
    description:
      "The complete op, selector and enum reference for apply_plan, with a worked example. Fetch this when unsure of a field name or an allowed value rather than guessing.",
    inputSchema: {},
  },
  async () => {
    const { body } = await call("/api/ai/describe");
    return json(body);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[discipline-mcp] connected to ${BASE}`);
