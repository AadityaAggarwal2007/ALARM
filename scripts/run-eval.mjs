#!/usr/bin/env node
/**
 * Runs the model eval across the pool, strictly one model at a time.
 *
 * Never concurrent: the account pool allows roughly one Claude request per
 * account before a 429, and a burst burns the whole pool for over an hour.
 * Flash models go first because they are effectively free and shake out any
 * harness problem cheaply; the two Claude models go last, behind a longer gap.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";

const TOKEN = process.env.DISCIPLINE_TOKEN;
const OUT = process.env.OUT || "eval-results.json";

const ORDER = [
  // Flash — cheap, run first.
  "gemini-3-flash",
  "gemini-3-flash-agent",
  "gemini-3.8-flash-tiered",
  "gemini-3.7-flash-tiered",
  "gemini-3.6-flash-tiered",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-3.5-flash-low",
  "gemini-3.5-flash-extra-low",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash",
  "gemini-2.5-flash-thinking",
  "gemini-2.5-flash-lite",
  // Pro — moderate quota.
  "gemini-3.1-pro-low",
  "gemini-pro-agent",
  "gemini-3.1-pro-high",
  "gemini-2.5-pro",
  // Claude — scarce. Last, and behind a long gap.
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
];

const GAP_MS = Number(process.env.GAP || 15) * 1000;
const CLAUDE_GAP_MS = Number(process.env.CLAUDE_GAP || 90) * 1000;

function runOne(model) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["scripts/model-eval.mjs", model],
      { env: { ...process.env, DISCIPLINE_TOKEN: TOKEN }, cwd: process.cwd() }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const killer = globalThis.setTimeout(() => child.kill("SIGKILL"), 15 * 60 * 1000);
    child.on("close", () => {
      globalThis.clearTimeout(killer);
      const line = out.trim().split("\n").pop() || "";
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({
          model,
          error: (err || out || "no output").slice(0, 300),
          tasks: [],
          passed: 0,
          total: 0,
        });
      }
    });
  });
}

const results = [];
for (let i = 0; i < ORDER.length; i++) {
  const model = ORDER[i];
  const isClaude = model.startsWith("claude");
  process.stderr.write(`[${i + 1}/${ORDER.length}] ${model} ... `);

  const r = await runOne(model);
  results.push(r);
  process.stderr.write(
    r.error ? `ERROR (${String(r.error).slice(0, 60)})\n` : `${r.passed}/${r.total} in ${r.seconds}s\n`
  );

  writeFileSync(OUT, JSON.stringify(results, null, 2));

  if (i < ORDER.length - 1) {
    const next = ORDER[i + 1];
    const gap = next.startsWith("claude") || isClaude ? CLAUDE_GAP_MS : GAP_MS;
    process.stderr.write(`    waiting ${gap / 1000}s\n`);
    await sleep(gap);
  }
}

console.log(JSON.stringify(results, null, 2));
