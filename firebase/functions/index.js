/**
 * Firebase Cloud Function: AI Auto-Triage
 * 
 * Automatically triggered when a new document lands in the 'requests' collection in Firestore.
 * Calls Claude AI (Anthropic API) to evaluate notes and update document with priority, flags, & summary.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
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

// RAAHAT Decision Support Engine Cloud Function
exports.generateDecisionSupport = onCall({ secrets: ['ANTHROPIC_API_KEY'] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { metrics } = request.data;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY secret is not set.');
  }

  const systemPrompt = `You are the RAAHAT AI Disaster Command Decision Engine.
Analyze the provided disaster command metrics and output ONLY a JSON object (no markdown fences, no other text) in this exact format:
{
  "overallSeverity": "STABLE" | "HIGH" | "CRITICAL",
  "priorityArea": "Name of priority area needing attention",
  "summary": "2-3 sentence overview of active incidents and capacity status",
  "recommendedActions": [
    "Action recommendation 1",
    "Action recommendation 2"
  ],
  "confidence": 91
}`;

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
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(metrics) }]
      })
    });

    if (!response.ok) {
      throw new HttpsError('internal', `Anthropic API error: ${response.status}`);
    }

    const aiData = await response.json();
    const textBlock = (aiData.content || []).find((b) => b.type === 'text');
    if (!textBlock) throw new HttpsError('internal', 'No text returned from AI.');

    const parsed = JSON.parse(textBlock.text.trim());
    return parsed;
  } catch (err) {
    console.error('generateDecisionSupport error:', err);
    throw new HttpsError('internal', err.message || 'Error executing AI decision support.');
  }
});

// RAAHAT Recommendation Explainer Cloud Function
exports.explainRecommendations = onCall({ secrets: ['ANTHROPIC_API_KEY'] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { sosRequest, hospital, shelter, resource } = request.data;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY secret is not set.');
  }

  const systemPrompt = `You are the RAAHAT AI Disaster Coordinator.
Explain why the recommended Hospital, Shelter, and Resource are matched to the selected citizen SOS request.
Provide a concise explanation for each recommendation.
Return ONLY a JSON object (no markdown fences, no other text) in this exact format:
{
  "hospitalExplanation": "Brief 1-2 sentence explanation of why this hospital was selected.",
  "shelterExplanation": "Brief 1-2 sentence explanation of why this shelter was selected.",
  "resourceExplanation": "Brief 1-2 sentence explanation of why this resource was matched."
}`;

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
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify({ sosRequest, hospital, shelter, resource }) }]
      })
    });

    if (!response.ok) {
      throw new HttpsError('internal', `Anthropic API error: ${response.status}`);
    }

    const aiData = await response.json();
    const textBlock = (aiData.content || []).find((b) => b.type === 'text');
    if (!textBlock) throw new HttpsError('internal', 'No text returned from AI.');

    const parsed = JSON.parse(textBlock.text.trim());
    return parsed;
  } catch (err) {
    console.error('explainRecommendations error:', err);
    throw new HttpsError('internal', err.message || 'Error generating explanations.');
  }
});

// RAAHAT Situation Report Cloud Function
exports.generateSituationReport = onCall({ secrets: ['ANTHROPIC_API_KEY'] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { metrics, activeIncidents } = request.data;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY secret is not set.');
  }

  const systemPrompt = `You are a Senior Crisis Responder writing a formal, professional Command Center Situation Report (SITREP) in Markdown.
Write a clear, structured report based on the provided metrics and incidents.
Include these sections:
1. Executive Summary (Overall Severity, key metrics)
2. Active Incidents and Triage Status
3. Critical Needs & Affected Population
4. Hospital Capacity & Shelter Logistical Status
5. Recommended Command Actions & Resource Relocation

Use professional command-center terminology. Write in markdown. Output ONLY the markdown report.`;

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
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify({ metrics, activeIncidents }) }]
      })
    });

    if (!response.ok) {
      throw new HttpsError('internal', `Anthropic API error: ${response.status}`);
    }

    const aiData = await response.json();
    const textBlock = (aiData.content || []).find((b) => b.type === 'text');
    if (!textBlock) throw new HttpsError('internal', 'No text returned from AI.');

    return { report: textBlock.text.trim() };
  } catch (err) {
    console.error('generateSituationReport error:', err);
    throw new HttpsError('internal', err.message || 'Error generating situation report.');
  }
});
