// QVAC FAQ Generator — core logic.
// completion() writes Q/A pairs from a Q1:/A1:/Q2:/A2:... format, which
// this small model follows fairly reliably for short structured lists.
// The one-shot example is real multi-turn history (not prose in the
// system prompt) so the model is much less likely to parrot it verbatim.

import { completion } from "@qvac/sdk";

function looksUnusable(text) {
  if (!text || text.trim().length === 0) return true;
  if (text.length > 400) return true;
  const bad = [
    "i cannot", "i can't", "as an ai", "i'm not able", "i do not have", "i don't have",
    "not enough information", "please provide more", "please try again",
    "i'd be happy to help", "could you provide", "can you provide", "i need more",
  ];
  const lower = text.toLowerCase();
  return bad.some((phrase) => lower.includes(phrase));
}

function cleanText(t) {
  return t.trim().replace(/^["']|["']$/g, "").replace(/^\*+|\*+$/g, "").trim();
}

const EXAMPLE_INPUT =
  "A mobile app that helps people track their daily water intake and reminds them to hydrate.";
const EXAMPLE_OUTPUT = `Q1: Does the app work without an internet connection?
A1: Yes, tracking your water intake works fully offline.
Q2: Can I set my own daily water goal?
A2: Yes, you can set a custom daily goal in the app settings.
Q3: How does the app remind me to drink water?
A3: It sends periodic reminders throughout the day based on your goal.
Q4: How much does the app cost?
A4: That isn't specified here — check the app listing for pricing.
Q5: Is my data shared with anyone?
A5: No, your intake data stays on your device.`;
const EXAMPLE_LOWER = EXAMPLE_OUTPUT.toLowerCase();

// Categories of specifics a small model tends to invent when a
// description doesn't actually cover them (exact prices, integrations,
// policies). If an answer asserts one of these and the same word root
// never appears in the user's own description, it's almost certainly
// fabricated — replace it with an honest "not specified" answer instead
// of a made-up fact, mirroring the example's Q4/A4 pattern above.
const HALLUCINATION_MARKERS = [
  "bank account", "integrat", "dashboard", "customiz", "onboard", "warranty",
  "refund", "subscription plan", "premium plan", "enterprise", "certified",
  "guarantee", "24/7", "live chat support", "loyalty program", "cancel",
  "trial", "delivery fee", "shipping fee", "international shipping", "import",
  "discount", "coupon", "gift card", "free trial",
];

function hasFabricatedSpecifics(answer, description) {
  const descLower = description.toLowerCase();
  const answerLower = answer.toLowerCase();

  // Currency amounts or percentages not present anywhere in the description.
  const numberMatches = answer.match(/\$\s?\d[\d,.]*|\d+(\.\d+)?%/g) || [];
  for (const n of numberMatches) {
    if (!description.includes(n)) return true;
  }

  for (const marker of HALLUCINATION_MARKERS) {
    if (answerLower.includes(marker) && !descLower.includes(marker.split(" ")[0])) {
      return true;
    }
  }
  return false;
}

function safeAnswer() {
  return "That isn't specified in the description above.";
}

function parsePairs(text) {
  const pairs = [];
  const re = /Q\d+:\s*(.+?)\s*\n\s*A\d+:\s*(.+?)(?=\n\s*Q\d+:|$)/gis;
  let match;
  while ((match = re.exec(text)) !== null) {
    const q = cleanText(match[1]);
    const a = cleanText(match[2].split("\n")[0]);
    if (q && a && !looksUnusable(q) && !looksUnusable(a)) {
      pairs.push({ q, a });
    }
  }
  return pairs;
}

function fallback(description) {
  const trimmed =
    description.length > 70 ? description.slice(0, 70).trim() + "..." : description;
  return [
    { q: "What does this offer?", a: `It's about: ${trimmed}` },
    { q: "How do I get started?", a: "Just use it as described above — no extra setup needed." },
    { q: "Is my information kept private?", a: "Yes, nothing described here suggests otherwise." },
    { q: "Who is this for?", a: `Anyone interested in: ${trimmed}` },
  ];
}

export async function generate(modelId, description) {
  const run = completion({
    modelId,
    history: [
      {
        role: "system",
        content:
          "You write realistic FAQ question-and-answer pairs for a product or service. " +
          "Given a description, output exactly 5 pairs in this exact format:\n" +
          "Q1: <question>\nA1: <answer>\nQ2: <question>\nA2: <answer>\nQ3: <question>\nA3: <answer>\n" +
          "Q4: <question>\nA4: <answer>\nQ5: <question>\nA5: <answer>\n" +
          "Every answer must be grounded only in the description given. Never invent an " +
          "exact price, a specific integration, or a policy detail that is not mentioned. " +
          "If a natural question (like pricing) isn't covered by the description, answer " +
          "honestly that it isn't specified rather than making up a number or feature. " +
          "No other text.",
      },
      { role: "user", content: `Description: ${EXAMPLE_INPUT}` },
      { role: "assistant", content: EXAMPLE_OUTPUT },
      { role: "user", content: `Description: ${description}` },
    ],
    stream: true,
    completionOpts: { temperature: 0.45, maxTokens: 500 },
  });

  let text = "";
  for await (const token of run.tokenStream) text += token;

  let pairs = parsePairs(text);
  // Guard against the model parroting the one-shot example verbatim when
  // the real description has nothing to do with water tracking.
  if (
    !description.toLowerCase().includes("water") &&
    !description.toLowerCase().includes("hydrat") &&
    pairs.some((p) => EXAMPLE_LOWER.includes(p.q.toLowerCase()) && p.q.toLowerCase().includes("water"))
  ) {
    pairs = pairs.filter((p) => !p.q.toLowerCase().includes("water"));
  }

  // Deterministic grounding pass: swap out any answer that asserts a
  // fabricated price/percentage or a common "invented SaaS feature" for
  // an honest "not specified" answer instead of letting the hallucination
  // reach the UI.
  pairs = pairs.map((p) =>
    hasFabricatedSpecifics(p.a, description) ? { q: p.q, a: safeAnswer() } : p
  );

  if (pairs.length < 4) {
    return { faqs: fallback(description) };
  }
  return { faqs: pairs.slice(0, 6) };
}
