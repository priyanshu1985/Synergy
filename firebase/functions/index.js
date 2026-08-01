/**
 * Firebase Cloud Function: AI Auto-Triage
 * 
 * Automatically triggered when a new document lands in the 'requests' collection in Firestore.
 * Calls Claude AI (Anthropic API) to evaluate notes and update document with priority, flags, & summary.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

admin.initializeApp();

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

exports.triageRequest = onDocumentCreated('requests/{requestId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY set. Skipping AI triage.');
    return;
  }

  const userContent = [
    `Situation category selected: ${data.situation}`,
    `People count: ${data.people_count}`,
    `Notes: ${data.notes || '(none written)'}`
  ].join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, await response.text());
      return;
    }

    const aiData = await response.json();
    const textBlock = (aiData.content || []).find((b) => b.type === 'text');
    if (!textBlock) return;

    const parsed = JSON.parse(textBlock.text);

    await snapshot.ref.update({
      ai_priority: parsed.priority || 'normal',
      ai_flags: parsed.flags || [],
      ai_summary: parsed.summary || '',
      ai_processed_at: new Date().toISOString()
    });

    console.log(`Successfully triaged request ${event.params.requestId} as ${parsed.priority}`);
  } catch (err) {
    console.error('Error during AI triage execution:', err);
  }
});
