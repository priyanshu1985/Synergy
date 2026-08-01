// supabase/functions/triage/index.ts
//
// What this does, in order:
// 1. Supabase calls this function automatically (via a Database Webhook, set up in
//    the README) every time a new row lands in `requests`.
// 2. It sends the situation + people count + free-text notes to Claude, asking for a
//    strict JSON verdict: priority, flags (medical/elderly/pregnant/etc.), and a
//    one-line summary a responder can read in half a second.
// 3. It writes that verdict back onto the same row. The dashboard is already
//    subscribed to UPDATEs on this table, so the AI tags appear live — no extra
//    wiring needed on the frontend for that part.
//
// This is deliberately "fail open": if the AI call or the parse fails for any reason,
// the function logs it and returns 200 without touching the row. The original request
// a citizen sent is never lost or blocked by this — AI triage is a helpful add-on,
// not something the core SOS flow depends on.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase —
// you don't set these yourself. ANTHROPIC_API_KEY is the one secret you do set,
// with: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SYSTEM_PROMPT = `You are a triage assistant for a flood disaster response system.
You will be given a citizen's self-reported situation, headcount, and free-text notes.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "priority": "critical" | "high" | "normal",
  "flags": string[],
  "summary": string
}

Rules:
- "critical": life-threatening right now (medical emergency, rising water with no escape, trapped, structural collapse risk).
- "high": urgent but not immediately life-threatening (vulnerable people present, running out of essential supplies, injury that isn't acute).
- "normal": needs help but stable for now.
- "flags": only include ones actually indicated by the text — choose from: medical_emergency, elderly, children, pregnant, disabled, no_supplies, structural_danger. Empty array if none apply. Never invent flags not supported by the text.
- "summary": one plain-language sentence, under 20 words, for a responder scanning a list fast.
- Base this only on what's stated. Do not guess at details not mentioned.`;

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Database Webhook payload shape: { type: "INSERT", table: "requests", record: {...} }
    const record = payload.record;
    if (!record || !record.id) {
      return new Response('No record in payload', { status: 400 });
    }

    const userContent = [
      `Situation category selected: ${record.situation}`,
      `People count: ${record.people_count}`,
      `Notes: ${record.notes || '(none written)'}`
    ].join('\n');

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022', // fast + cheap — this only needs to classify, not reason deeply
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!aiRes.ok) {
      console.error('Anthropic API error:', aiRes.status, await aiRes.text());
      return new Response('AI call failed', { status: 200 }); // 200 so the webhook doesn't retry-storm
    }

    const aiData = await aiRes.json();
    const textBlock = (aiData.content || []).find((b: any) => b.type === 'text');

    let parsed: { priority?: string; flags?: string[]; summary?: string };
    try {
      parsed = JSON.parse(textBlock?.text ?? '');
    } catch {
      console.error('Could not parse AI response as JSON:', textBlock?.text);
      return new Response('Bad AI JSON', { status: 200 });
    }

    const { error } = await supabase
      .from('requests')
      .update({
        ai_priority: parsed.priority ?? null,
        ai_flags: parsed.flags ?? [],
        ai_summary: parsed.summary ?? null,
        ai_processed_at: new Date().toISOString()
      })
      .eq('id', record.id);

    if (error) {
      console.error('Failed to write AI triage back to row:', error);
      return new Response('DB update failed', { status: 200 });
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('Unhandled error in triage function:', err);
    return new Response('Unhandled error', { status: 200 });
  }
});
