# QVAC FAQ Generator

Enter a product or service description and an on-device AI writes 4-6 realistic FAQ question and answer pairs grounded in it. No cloud call, no API key.

## Run

```bash
npm install
npm start
```

Then open http://localhost:31013

Requires Node.js >= 22.17 (see `engines` in `package.json`).

## QVAC SDK version

`@qvac/sdk` ^0.19.0 (see `package.json`).

## How it works

Built on [Tether's QVAC SDK](https://www.npmjs.com/package/@qvac/sdk) — all inference runs on-device, no cloud call, no API key.

1. `loadModel({ modelSrc: LLAMA_3_2_1B_INST_Q4_0 })` loads the model once at startup, before the HTTP server starts accepting requests.
2. Each `POST /api/faq` request calls `completion()` with a one-shot example baked into the chat history (a real user/assistant turn, not just prose instructions) and streams the reply token-by-token via `run.tokenStream`.
3. `unloadModel({ modelId })` releases the model on `SIGINT`/`SIGTERM`.

The response is passed through `generate()` in `src/faq.js`, which parses the model's `Qn:`/`An:` lines into pairs and then runs a deterministic grounding pass: any answer that asserts a dollar amount or percentage not present in the original description, or that mentions a "hallucination marker" word (like "refund", "subscription plan", "integrat...") not rooted in the description, is swapped for an honest "not specified" answer instead of a fabricated one. If fewer than 4 pairs survive, a fixed fallback FAQ (built directly from the description, no model involved) is returned instead.

### Example

Input:

> A mobile app that helps people track their daily water intake and reminds them to hydrate.

Output:

```
Q1: Does the app work without an internet connection?
A1: Yes, tracking your water intake works fully offline.
Q2: Can I set my own daily water goal?
A2: Yes, you can set a custom daily goal in the app settings.
Q3: How does the app remind me to drink water?
A3: It sends periodic reminders throughout the day based on your goal.
Q4: How much does the app cost?
A4: That isn't specified here — check the app listing for pricing.
Q5: Is my data shared with anyone?
A5: No, your intake data stays on your device.
```

This exact pair is also the one-shot example baked into the prompt (see `EXAMPLE_INPUT`/`EXAMPLE_OUTPUT` in `src/faq.js`), including the honest "not specified" answer pattern (Q4/A4) the model is meant to imitate for facts not in a real description.

## License

MIT
