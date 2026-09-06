#!/usr/bin/env node
/**
 * Can a given model actually drive Discipline?
 *
 * Each model gets the real MCP tool definitions and a plain-English task, runs
 * a real agentic loop against the live API, and is then judged on what ended up
 * in the database — not on whether its JSON looked plausible.
 *
 * Sequential by design, one model at a time with a gap between, because the
 * pool allows roughly one Claude request per account before a 429.
 *
 *   node scripts/model-eval.mjs <model> [--gap 15]
 */

import { setTimeout as sleep } from "node:timers/promises";

const PROXY = process.env.PROXY_URL || "http://localhost:8080";
const APP = process.env.DISCIPLINE_URL || "https://alarm.axonagent.online";
const TOKEN = process.env.DISCIPLINE_TOKEN;
const MODEL = process.argv[2];

if (!MODEL || !TOKEN) {
  console.error("usage: DISCIPLINE_TOKEN=... node scripts/model-eval.mjs <model>");
  process.exit(1);
}

/** Every test artifact carries this, so cleanup never touches real data. */
const NS = "eval";

// ----------------------------------------------------------------- the tools

const TOOLS = [
  {
    name: "get_schedule",
    description:
      "Everything needed to reason about the schedule in one call: today's date and timezone, categories, blocks in a window, repeating rules, goals, inbox. Params: from, days (default 14), include (subset of categories/blocks/rules/goals/inbox), analytics.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string" },
        days: { type: "number" },
        include: { type: "array", items: { type: "string" } },
        analytics: { type: "boolean" },
      },
    },
  },
  {
    name: "apply_plan",
    description:
      "The single write tool. Send every intent as ONE plan; do not loop one call per block. A whole term of classes is one `schedule` op with `repeat`. \"Make the Friday ones vibrate\" is one `update` op with a weekday selector. " +
      "Nothing repeats unless you pass `repeat`. update/delete never rewrite a repeating rule unless you pass `scope` (this|future|all); if your selector hits rule-generated blocks without a scope the call is REFUSED with needsScope and nothing is written — relay that question to the user rather than guessing. " +
      'Times are local wall-clock: "16:00-18:00", never ISO or UTC. Dates are "YYYY-MM-DD". ' +
      'Ops: schedule {key,title,category,sub,time,date|dates,repeat:{weekdays,until},note,enforce:{mode,challenge,difficulty,streak,say},remind}, update {where,set,scope}, delete {where,scope}, goal {title,metric,direction,target,scope,until}, goal_delete, inbox, rule. ' +
      'Selector `where`: {key,category,sub,note,from,to,weekdays,nth:odd|even,enforced,ids}. ' +
      "enforce.mode: SILENT|VIBRATE|SIREN|VOICE. difficulty: easy|medium|hard. streak: 1|3|5.",
    input_schema: {
      type: "object",
      properties: {
        ops: { type: "array", items: { type: "object" } },
        dryRun: { type: "boolean" },
      },
      required: ["ops"],
    },
  },
  {
    name: "describe_api",
    description:
      "Full op, selector and enum reference for apply_plan, with a worked example. Fetch when unsure of a field name rather than guessing.",
    input_schema: { type: "object", properties: {} },
  },
];

// ------------------------------------------------------------------ plumbing

async function app(path, init = {}, attempt = 0) {
  try {
    const res = await fetch(`${APP}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: `non-JSON ${res.status}` };
    }
  } catch (e) {
    // The tunnel drops the occasional request. Without this a single blip
    // scores a model zero on a task it never actually got to attempt.
    if (attempt < 3) {
      await sleep(1500 * (attempt + 1));
      return app(path, init, attempt + 1);
    }
    return { ok: false, error: `network: ${e.message}` };
  }
}

async function runTool(name, input) {
  if (name === "get_schedule") {
    const p = new URLSearchParams();
    if (input.from) p.set("from", input.from);
    if (input.days) p.set("days", String(input.days));
    if (input.include?.length) p.set("include", input.include.join(","));
    if (input.analytics) p.set("analytics", "1");
    return app(`/api/ai/context?${p}`);
  }
  if (name === "apply_plan") {
    return app("/api/ai/apply", {
      method: "POST",
      body: JSON.stringify({ ops: input.ops, dryRun: input.dryRun === true }),
    });
  }
  if (name === "describe_api") return app("/api/ai/describe");
  return { error: `unknown tool ${name}` };
}

/** One agentic turn-loop against the proxy. */
async function converse(system, userText, maxTurns = 6) {
  const messages = [{ role: "user", content: userText }];
  const calls = [];
  let stopReason = null;

  for (let turn = 0; turn < maxTurns; turn++) {
    let res;
    try {
      res = await fetch(`${PROXY}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "dummy",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools: TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      if (turn === 0) throw new Error(`proxy unreachable: ${e.message}`);
      break;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`proxy ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    if (data.type === "error") {
      throw new Error(data.error?.message || "model error");
    }

    const content = data.content || [];
    stopReason = data.stop_reason;
    messages.push({ role: "assistant", content });

    const uses = content.filter((c) => c.type === "tool_use");
    if (uses.length === 0) break;

    const results = [];
    for (const u of uses) {
      calls.push({ name: u.name, input: u.input });
      const out = await runTool(u.name, u.input || {});
      results.push({
        type: "tool_result",
        tool_use_id: u.id,
        content: JSON.stringify(out).slice(0, 6000),
      });
    }
    messages.push({ role: "user", content: results });
  }

  const finalText = (messages[messages.length - 1]?.content || [])
    .filter?.((c) => c.type === "text")
    ?.map((c) => c.text)
    .join(" ") || "";

  return { calls, stopReason, finalText };
}

// -------------------------------------------------------------------- checks

async function dbState() {
  const ctx = await app(`/api/ai/context?days=90&include=blocks,rules,goals`);
  return {
    blocks: (ctx.blocks || []).filter((b) => b.key?.startsWith(NS)),
    rules: (ctx.rules || []).filter((r) => r.key?.startsWith(NS)),
    goals: (ctx.goals || []).filter((g) => g.title?.includes("Eval")),
  };
}

async function cleanup() {
  const s = await dbState();
  const ops = [];
  for (const r of s.rules) ops.push({ op: "rule", key: r.key, action: "delete" });
  for (const g of s.goals) ops.push({ op: "goal_delete", title: g.title });
  if (ops.length) await app("/api/ai/apply", { method: "POST", body: JSON.stringify({ ops }) });
  // Anything left that carries the namespace, including one-off blocks.
  const left = await dbState();
  if (left.blocks.length) {
    const keys = [...new Set(left.blocks.map((b) => b.key))];
    await app("/api/ai/apply", {
      method: "POST",
      body: JSON.stringify({ ops: keys.map((k) => ({ op: "delete", where: { key: k }, scope: "all" })) }),
    });
  }
}

const DEAD_ALIAS =
  /no longer available|not available|has been (retired|deprecated)|please switch to/i;

const SYSTEM =
  "You manage the user's schedule with the given tools. Be efficient: express the whole request " +
  "as few tool calls as possible. Today's date and timezone come from get_schedule if you need them.";

// --------------------------------------------------------------------- tasks

const TASKS = [
  {
    id: "term",
    prompt:
      `Set up my Physics classes: every Monday, Wednesday and Friday from 4pm to 6pm, running until 15 December 2026. ` +
      `They must ring with a siren, medium difficulty maths, 3 correct in a row. ` +
      `Also set me a goal of 12 hours of Study per week until that same date. ` +
      `Use the plan key "${NS}-physics" for the classes and title the goal "Eval study target".`,
    async score(calls, state) {
      const plans = calls.filter((c) => c.name === "apply_plan");
      const op = plans.flatMap((p) => p.input?.ops || []).find((o) => o.op === "schedule");
      const goal = plans.flatMap((p) => p.input?.ops || []).find((o) => o.op === "goal");
      const time = String(op?.time || "");
      return {
        "one write call": plans.length === 1,
        "used repeat (not N dates)": Boolean(op?.repeat?.weekdays?.length) && !op?.dates,
        "wall-clock time": /^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(time),
        "correct enforce": String(op?.enforce?.mode).toUpperCase() === "SIREN" &&
          String(op?.enforce?.difficulty).toLowerCase() === "medium" &&
          Number(op?.enforce?.streak) === 3,
        "until date set": String(op?.repeat?.until || "").startsWith("2026-12-15"),
        "goal in same plan": Boolean(goal) && plans.length === 1,
        "blocks created": state.blocks.length >= 20,
        "rule created": state.rules.length >= 1,
      };
    },
  },
  {
    id: "scope-gate",
    prompt:
      `Change just the Friday Physics sessions so they vibrate instead of using the siren. ` +
      `Keep Monday and Wednesday exactly as they are.`,
    async score(calls, state) {
      const plans = calls.filter((c) => c.name === "apply_plan");
      const upd = plans.flatMap((p) => p.input?.ops || []).find((o) => o.op === "update");
      const wd = (upd?.where?.weekdays || []).map((d) => String(d).toUpperCase());
      const fri = state.blocks.filter((b) => b.weekday === "FRIDAY");
      const other = state.blocks.filter((b) => b.weekday !== "FRIDAY");
      return {
        "selected by weekday": wd.some((d) => d.startsWith("FRI")),
        "did not loop per block": plans.length <= 2,
        "fridays now vibrate": fri.length > 0 && fri.every((b) => b.enforce?.mode === "VIBRATE"),
        "mon/wed untouched": other.length > 0 && other.every((b) => b.enforce?.mode === "SIREN"),
      };
    },
  },
  {
    id: "one-off",
    prompt:
      `Add a single 2-hour study block this coming Saturday at 10am. ` +
      `This is a one-off, it must NOT repeat. Use the plan key "${NS}-sat".`,
    async score(calls, state) {
      const plans = calls.filter((c) => c.name === "apply_plan");
      const op = plans.flatMap((p) => p.input?.ops || []).find((o) => o.op === "schedule");
      const sat = state.blocks.filter((b) => b.key === `${NS}-sat`);
      return {
        "no repeat requested": Boolean(op) && !op.repeat,
        "exactly one block": sat.length === 1,
        "landed on a Saturday": sat[0]?.weekday === "SATURDAY",
      };
    },
  },
];

// ---------------------------------------------------------------------- main

const started = Date.now();
const report = { model: MODEL, tasks: [], error: null, unavailable: null, termFailed: false };

try {
  await cleanup();
  for (const task of TASKS) {
    const t0 = Date.now();
    let calls = [], err = null, finalText = "";

    // A model that could not do the first task cannot meaningfully attempt the
    // ones that build on it. Recording those as skipped rather than failed
    // keeps the score honest about what was actually measured.
    if (report.unavailable || (task.id !== "term" && report.termFailed)) {
      report.tasks.push({
        id: task.id,
        skipped: true,
        reason: report.unavailable ? "model unavailable" : "term task failed",
        checks: {},
        passed: 0,
        total: 0,
        toolCalls: 0,
        seconds: 0,
      });
      continue;
    }

    try {
      const r = await converse(SYSTEM, task.prompt);
      calls = r.calls;
      finalText = r.finalText;
    } catch (e) {
      err = e.message;
    }

    if (calls.length === 0 && DEAD_ALIAS.test(finalText)) {
      report.unavailable = finalText.slice(0, 160);
      report.tasks.push({
        id: task.id,
        skipped: true,
        reason: "model unavailable",
        note: finalText.slice(0, 160),
        checks: {},
        passed: 0,
        total: 0,
        toolCalls: 0,
        seconds: Math.round((Date.now() - t0) / 1000),
      });
      continue;
    }

    const noTools = !err && calls.length === 0;
    const state = await dbState();
    const checks = err ? {} : await task.score(calls, state);
    const passed = Object.values(checks).filter(Boolean).length;

    if (task.id === "term" && (err || passed < 4)) report.termFailed = true;

    report.tasks.push({
      id: task.id,
      error: err,
      noToolUse: noTools || undefined,
      seconds: Math.round((Date.now() - t0) / 1000),
      toolCalls: calls.length,
      // The ops actually sent, so a failure can be diagnosed rather than guessed at.
      ops: calls
        .filter((c) => c.name === "apply_plan")
        .flatMap((c) => c.input?.ops || [])
        .slice(0, 6),
      checks,
      passed,
      total: Object.keys(checks).length,
      note: finalText.slice(0, 220),
    });
    await sleep(2000);
  }
} catch (e) {
  report.error = e.message;
} finally {
  await cleanup().catch(() => {});
}

report.seconds = Math.round((Date.now() - started) / 1000);
report.passed = report.tasks.reduce((s, t) => s + t.passed, 0);
report.total = report.tasks.reduce((s, t) => s + t.total, 0);
console.log(JSON.stringify(report));
