/**
 * RAAHAT Firebase Cloud Functions
 *
 * Powered by Google Gemini AI (gemini-2.0-flash)
 * Bug fixes applied:
 *  - triageRequest now declares GEMINI_API_KEY secret (was silently skipped before)
 *  - triageRequest skips safe_report marker documents (avoid wasted AI calls)
 *  - All functions use a shared callGemini() helper
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();

// ─── Shared Gemini Helper ────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.0-flash';

async function callGemini(apiKey, systemPrompt, userContent, maxTokens = 400) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.1  // Low temperature for consistent structured output
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');

  // Strip markdown code fences if Gemini wraps the JSON
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

// ─── 1. AI Auto-Triage ───────────────────────────────────────────────────────
// Triggered when a new SOS request document is created in Firestore.
// Classifies priority and extracts flags using Gemini AI.

const TRIAGE_SYSTEM_PROMPT = `You are a triage assistant for a flood disaster response system.
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

// BUG FIX 1: Added { secrets: ['GEMINI_API_KEY'] } — without this the secret
//            was never injected and AI triage was silently skipped on every SOS.
// BUG FIX 2: Skip safe_report marker documents created by the "I'm Safe" button.
// Renamed from triageRequest → autoTriageSOS to avoid type-conflict with old deployment.
exports.autoTriageSOS = onDocumentCreated(
  { document: 'requests/{requestId}', secrets: ['GEMINI_API_KEY'] },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const data = snapshot.data();

    // BUG FIX 2: Skip non-SOS marker documents (e.g. safe_report created by citizen app)
    if (data.type === 'safe_report') {
      console.log(`Skipping safe_report document: ${event.params.requestId}`);
      return;
    }

    // Also skip if already triaged (e.g. dashboard fallback already ran)
    if (data.ai_priority) {
      console.log(`Request ${event.params.requestId} already triaged. Skipping.`);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('No GEMINI_API_KEY set. Skipping AI triage.');
      return;
    }

    const userContent = [
      `Situation category: ${data.situation}`,
      `People affected: ${data.people_count || 1}`,
      `Notes: ${data.notes || '(none provided)'}`
    ].join('\n');

    try {
      const raw = await callGemini(apiKey, TRIAGE_SYSTEM_PROMPT, userContent, 300);
      const parsed = JSON.parse(raw);

      await snapshot.ref.update({
        ai_priority: parsed.priority || 'normal',
        ai_flags: parsed.flags || [],
        ai_summary: parsed.summary || '',
        ai_processed_at: new Date().toISOString(),
        ai_engine: 'gemini-2.0-flash'
      });

      console.log(`Triaged ${event.params.requestId} → ${parsed.priority} (Gemini)`);
    } catch (err) {
      console.error('AI triage error:', err.message);
    }
  }
);

// ─── 2. Decision Support Engine ──────────────────────────────────────────────
// Called by dashboard to generate command-center AI recommendations.

exports.generateDecisionSupport = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY not set.');

    const { metrics } = request.data;

    const systemPrompt = `You are the RAAHAT AI Disaster Command Decision Engine.
Analyze the provided disaster command metrics and output ONLY a JSON object (no markdown, no extra text) in this exact format:
{
  "overallSeverity": "STABLE" | "HIGH" | "CRITICAL",
  "priorityArea": "Name of the area needing most urgent attention",
  "summary": "2-3 sentence overview of active incidents and current capacity status",
  "recommendedActions": [
    "Specific action recommendation 1",
    "Specific action recommendation 2",
    "Specific action recommendation 3"
  ],
  "confidence": 91
}`;

    try {
      const raw = await callGemini(apiKey, systemPrompt, JSON.stringify(metrics), 500);
      return JSON.parse(raw);
    } catch (err) {
      console.error('generateDecisionSupport error:', err.message);
      throw new HttpsError('internal', err.message || 'AI decision support failed.');
    }
  }
);

// ─── 3. Recommendation Explainer ─────────────────────────────────────────────
// Explains why a specific hospital, shelter, and resource were recommended for an SOS.

exports.explainRecommendations = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY not set.');

    const { sosRequest, hospital, shelter, resource } = request.data;

    const systemPrompt = `You are the RAAHAT AI Disaster Coordinator.
Explain why the recommended Hospital, Shelter, and Rescue Resource are the best match for the given citizen SOS request.
Return ONLY a JSON object (no markdown, no extra text) in this exact format:
{
  "hospitalExplanation": "1-2 sentence explanation of why this hospital was selected.",
  "shelterExplanation": "1-2 sentence explanation of why this shelter was selected.",
  "resourceExplanation": "1-2 sentence explanation of why this rescue resource was matched."
}`;

    try {
      const raw = await callGemini(
        apiKey, systemPrompt,
        JSON.stringify({ sosRequest, hospital, shelter, resource }),
        500
      );
      return JSON.parse(raw);
    } catch (err) {
      console.error('explainRecommendations error:', err.message);
      throw new HttpsError('internal', err.message || 'AI explanation failed.');
    }
  }
);

// ─── 4. Situation Report (SITREP) Generator ──────────────────────────────────
// Generates a full professional command-center situation report in Markdown.

exports.generateSituationReport = onCall(
  { secrets: ['GEMINI_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY not set.');

    const { metrics, activeIncidents } = request.data;

    const systemPrompt = `You are a Senior Crisis Responder writing a formal, professional Command Center Situation Report (SITREP) in Markdown.
Write a clear, structured report based on the provided metrics and active incidents.
Include these sections:
1. Executive Summary (Overall Severity, key metrics)
2. Active Incidents and Triage Status
3. Critical Needs & Affected Population
4. Hospital Capacity & Shelter Logistical Status
5. Recommended Command Actions & Resource Relocation

Use professional command-center terminology. Write in Markdown. Output ONLY the Markdown report, no other text.`;

    try {
      const text = await callGemini(
        apiKey, systemPrompt,
        JSON.stringify({ metrics, activeIncidents }),
        1200
      );
      return { report: text };
    } catch (err) {
      console.error('generateSituationReport error:', err.message);
      throw new HttpsError('internal', err.message || 'AI situation report failed.');
    }
  }
);
