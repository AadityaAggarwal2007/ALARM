#!/usr/bin/env node
/**
 * The same three trials, for OpenAI-shaped providers (OpenRouter).
 *
 * A separate file rather than a flag on model-eval.mjs because the two wire
 * formats differ in every part that matters: tools are wrapped in a `function`
 * envelope, arguments arrive as a JSON *string* that has to be parsed and can
 * be malformed, and results go back as `role: "tool"` messages keyed by id.
 * Scoring is identical — read the database, not the model's own account of
 * what it did.
 *
 *   OPENROUTER_KEY=... DISCIPLINE_TOKEN=... node scripts/model-eval-openai.mjs <model>
 */

import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.OPENAI_BASE || "https://openrouter.ai/api/v1";
const KEY = process.env.OPENROUTER_KEY;
const APP = process.env.DISCIPLINE_URL || "https://alarm.axonagent.online";
const TOKEN = process.env.DISCIPLINE_TOKEN;
const MODEL = process.argv[2];

if (!MODEL || !TOKEN || !KEY) {
  console.error("usage: OPENROUTER_KEY=... DISCIPLINE_TOKEN=... node scripts/model-eval-openai.mjs <model>");
  process.exit(1);
}

const NS = "eval";

/**
 * EVAL SAFETY — read before pointing this at anything you care about.
 *
 * Namespacing the artifacts is not enough. A model is free to send a selector
 * with no key — "all Friday blocks" — and the API will act on it. During one
 * run that split the user's real wake-up rule, moving its Fridays onto a
 * separate rule with a different alarm mode, and flipped two of their own
 * blocks from SIREN to VIBRATE. Everything was restored by hand afterwards.
 *
 * Point DISCIPLINE_URL at a scratch instance. If that is not possible, take a
 * backup first and diff the rules when the run finishes.
 */


const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_schedule",
      description:
        "Everything needed to reason about the schedule in one call: today's date and timezone, categories, blocks in a window, repeating rules, goals, inbox.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: 'Start date "YYYY-MM-DD".' },
          days: { type: "number", description: "Window length, default 14." },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Subset of categories, blocks, rules, goals, inbox.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_plan",
      description:
        "The single write tool. Send every intent as ONE plan; do not loop one call per block. A whole term of classes is one `schedule` op with `repeat`. \"Make the Friday ones vibrate\" is one `update` op with a weekday selector. " +
        "Nothing repeats unless you pass `repeat`. update/delete never rewrite a repeating rule unless you pass `scope` (this|future|all). " +
        'Times are local wall-clock: "16:00-18:00", never ISO. Dates are "YYYY-MM-DD". ' +
        'Ops: schedule {key,title,category,sub,time,date|dates,repeat:{weekdays,until},note,enforce:{mode,challenge,difficulty,streak}}, update {where,set,scope}, delete {where,scope}, goal {title,metric,direction,target,scope,until}. ' +
        'Selector `where`: {key,category,sub,note,from,to,weekdays,nth,enforced,ids}. ' +
        "enforce.mode: SILENT|VIBRATE|SIREN|VOICE. difficulty: easy|medium|hard. streak: 1|3|5.",
      parameters: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            items: { type: "object" },
            description:
              'Operations. Each has "op": schedule|update|delete|goal. Example: [{"op":"schedule","key":"physics","title":"Physics","category":"Study","time":"16:00-18:00","repeat":{"weekdays":["MONDAY","WEDNESDAY"],"until":"2026-12-15"},"enforce":{"mode":"SIREN","difficulty":"medium","streak":3}}]',
          },
          dryRun: { type: "boolean" },
        },
        required: ["ops"],
      },
    },
  },
];

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
    return app(`/api/ai/context?${p}`);
  }
  if (name === "apply_plan") {
    return app("/api/ai/apply", {
      method: "POST",
      body: JSON.stringify({ ops: input.ops, dryRun: input.dryRun === true }),
    });
  }
  return { error: `unknown tool ${name}` };
}

async function converse(system, userText, maxTurns = 6) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: userText },
  ];
  const calls = [];
  let badJson = 0;
  let finalText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    let res;
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
          "HTTP-Referer": "https://alarm.axonagent.online",
          "X-Title": "Discipline model trial",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 3000,
          tools: TOOLS,
          tool_choice: "auto",
          messages,
        }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      if (turn === 0) throw new Error(`provider unreachable: ${e.message}`);
      break;
    }

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`non-JSON from provider (${res.status}): ${raw.slice(0, 200)}`);
    }
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error).slice(0, 200));
    }

    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error(`no message in response: ${raw.slice(0, 200)}`);
    messages.push(msg);
    finalText = msg.content || finalText;

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let input = {};
      try {
        // Arguments arrive as a string. A model that emits malformed JSON here
        // fails before the API ever sees it, which is worth counting separately
        // from getting the schema wrong.
        input = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        badJson += 1;
      }
      calls.push({ name, input });
      const out = await runTool(name, input);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(out).slice(0, 5000),
      });
    }
  }

  return { calls, finalText: finalText || "", badJson };
}

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
  if (ops.length) {
    await app("/api/ai/apply", { method: "POST", body: JSON.stringify({ ops }) });
  }
  const left = await dbState();
  if (left.blocks.length) {
    const keys = [...new Set(left.blocks.map((b) => b.key))];
    await app("/api/ai/apply", {
      method: "POST",
      body: JSON.stringify({
        ops: keys.map((k) => ({ op: "delete", where: { key: k }, scope: "all" })),
      }),
    });
  }
}

const SYSTEM =
  "You manage the user's schedule with the given tools. Be efficient: express the whole request " +
  "as few tool calls as possible. Always call a tool rather than describing what you would do.";

const TASKS = [
  {
    id: "term",
    prompt:
      `Set up my Physics classes: every Monday, Wednesday and Friday from 4pm to 6pm, running until 15 December 2026. ` +
      `They must ring with a siren, medium difficulty maths, 3 correct in a row. ` +
      `Also set me a goal of 12 hours of Study per week until that same date. ` +
      `Use the plan key "${NS}-physics" for the classes and title the goal "Eval study target".`,
    score(calls, state) {
      const plans = calls.filter((c) => c.name === "apply_plan");
      const allOps = plans.flatMap((p) => p.input?.ops || []);
      const op = allOps.find((o) => o.op === "schedule" || o.schedule);
      const goal = allOps.find((o) => o.op === "goal" || o.goal);
      const body = op?.schedule || op || {};
      const time = String(body.time || "");
      const enf = body.enforce || {};
      return {
        "one write call": plans.length === 1,
        "used repeat (not N dates)": Boolean(body.repeat?.weekdays?.length) && !body.dates,
        "wall-clock time": /^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(time),
        "correct enforce":
          String(enf.mode).toUpperCase() === "SIREN" &&
          String(enf.difficulty).toLowerCase() === "medium" &&
          Number(enf.streak) === 3,
        "until date set": String(body.repeat?.until || "").startsWith("2026-12-15"),
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
    score(calls, state) {
      const plans = calls.filter((c) => c.name === "apply_plan");
      const allOps = plans.flatMap((p) => p.input?.ops || []);
      const upd = allOps.find((o) => o.op === "update" || o.update);
      const body = upd?.update || upd || {};
      const wd = (body.where?.weekdays || []).map((d) => String(d).toUpperCase());
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
    score(calls, state) {
      const plans = calls.filter((c) => c.name === "apply_plan");
      const allOps = plans.flatMap((p) => p.input?.ops || []);
      const op = allOps.find((o) => o.op === "schedule" || o.schedule);
      const body = op?.schedule || op || {};
      const sat = state.blocks.filter((b) => b.key === `${NS}-sat`);
      return {
        "no repeat requested": Boolean(op) && !body.repeat,
        "exactly one block": sat.length === 1,
        "landed on a Saturday": sat[0]?.weekday === "SATURDAY",
      };
    },
  },
];

const started = Date.now();
const report = { model: MODEL, provider: "openrouter", tasks: [], error: null, badJson: 0, termFailed: false };

try {
  await cleanup();
  for (const task of TASKS) {
    if (task.id !== "term" && report.termFailed) {
      report.tasks.push({
        id: task.id,
        skipped: true,
        reason: "term task failed",
        checks: {},
        passed: 0,
        total: 0,
        toolCalls: 0,
        seconds: 0,
      });
      continue;
    }

    const t0 = Date.now();
    let calls = [], err = null, finalText = "", badJson = 0;
    try {
      const r = await converse(SYSTEM, task.prompt);
      calls = r.calls;
      finalText = r.finalText;
      badJson = r.badJson;
    } catch (e) {
      err = e.message;
    }
    report.badJson += badJson;

    const state = await dbState();
    const checks = err ? {} : task.score(calls, state);
    const passed = Object.values(checks).filter(Boolean).length;
    if (task.id === "term" && (err || passed < 4)) report.termFailed = true;

    report.tasks.push({
      id: task.id,
      error: err,
      noToolUse: !err && calls.length === 0 ? true : undefined,
      badJson: badJson || undefined,
      seconds: Math.round((Date.now() - t0) / 1000),
      toolCalls: calls.length,
      ops: calls
        .filter((c) => c.name === "apply_plan")
        .flatMap((c) => c.input?.ops || [])
        .slice(0, 4),
      checks,
      passed,
      total: Object.keys(checks).length,
      note: (finalText || "").slice(0, 200),
    });
    await sleep(1500);
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
