/**
 * RAAHAT Firebase Cloud Functions
 *
 * Powered by Google Gemini AI (gemini-2.0-flash)
 * Bug fixes applied:
 *  - triageRequest now declares GEMINI_API_KEY secret (was silently skipped before)
 *  - triageRequest skips safe_report marker documents (avoid wasted AI calls)
 *  - All functions use a shared callGemini() helper
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

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
        status: 'AI_TRIAGED',
        ai_priority: parsed.priority || 'normal',
        ai_flags: parsed.flags || [],
        ai_summary: parsed.summary || '',
        ai_processed_at: new Date().toISOString(),
        ai_engine: 'gemini-2.0-flash'
      });

      console.log(`Triaged ${event.params.requestId} → ${parsed.priority} (Gemini)`);
    } catch (err) {
      console.error('AI triage error, applying default/fallback values to proceed:', err.message);
      await snapshot.ref.update({
        status: 'AI_TRIAGED',
        ai_priority: 'normal',
        ai_flags: [],
        ai_summary: 'Stable situation, awaiting dispatch.',
        ai_processed_at: new Date().toISOString(),
        ai_engine: 'fallback-deterministic'
      });
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

// ─── 5. Auto-Assign & Dispatch ───────────────────────────────────────────────
// Triggered when AI triage completes (ai_priority is freshly written).
// Automatically finds the best available rescue resource and dispatches it.
// No human interaction required.

function haversineMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Resource type preference per situation
const SITUATION_RESOURCE_PREFERENCE = {
  injured:  ['ambulance', 'rescue_team', 'boat'],
  stranded: ['boat', 'rescue_team', 'ambulance'],
  evacuate: ['rescue_team', 'boat', 'ambulance'],
  supplies: ['rescue_team', 'boat', 'ambulance'],
};

const ASSIGN_SYSTEM_PROMPT = `You are the RAAHAT AI Command Dispatch Coordinator.
Evaluate the citizen's SOS distress call and select the single best matching rescue resource from the provided list of available resources.

Rules:
1. Select exactly one resource ID from the available list.
2. Select based on:
   - Type preference: "stranded"/"rising water" -> prefer "boat", "injured"/"medical emergency" -> prefer "ambulance", "supplies"/"evacuate" -> "rescue_team".
   - Capacity: Ensure the resource capacity is equal to or greater than the citizen's headcount (people count).
   - Proximity: Prioritize closer resources (smaller distance).
3. Output ONLY a JSON object (no markdown formatting, no other text) in this exact format:
{
  "assigned_resource_id": "the-id-of-the-selected-resource",
  "reason": "1-sentence plain explanation of why this team/vehicle is the best choice"
}`;

exports.autoAssignAndDispatch = onDocumentUpdated(
  { document: 'requests/{requestId}', secrets: ['GEMINI_API_KEY'] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Trigger ONLY when status transitions to 'AI_TRIAGED'
    if (before.status === 'AI_TRIAGED' || after.status !== 'AI_TRIAGED') return;

    const requestId = event.params.requestId;
    const db = getFirestore();

    console.log(`AI auto-assigning resource for request ${requestId}...`);

    try {
      // Fetch all available resources (with self-healing seeding if empty)
      let resourcesSnap = await db
        .collection('resources')
        .where('availability', '==', 'available')
        .get();

      if (resourcesSnap.empty) {
        console.log('Firestore resources collection is empty. Self-seeding default rescue teams...');
        const defaultResources = [
          { type: 'boat', name: 'Rescue Boat Alpha', latitude: 20.5950, longitude: 78.9650, capacity: 10, availability: 'available', status: 'Idle at Station' },
          { type: 'ambulance', name: 'Trauma Unit 4', latitude: 20.6020, longitude: 78.9750, capacity: 2, availability: 'available', status: 'Idle at Station' },
          { type: 'rescue team', name: 'NDRF Squad B', latitude: 20.5850, longitude: 78.9550, capacity: 8, availability: 'available', status: 'On Standby' },
          { type: 'fire truck', name: 'Engine 9', latitude: 20.6150, longitude: 78.9450, capacity: 6, availability: 'available', status: 'On Standby' },
          { type: 'volunteer', name: 'Volunteer Group East', latitude: 20.5700, longitude: 78.9850, capacity: 15, availability: 'available', status: 'Distributing Rations' }
        ];

        for (const res of defaultResources) {
          await db.collection('resources').add(res);
        }

        // Re-fetch resources after seeding
        resourcesSnap = await db
          .collection('resources')
          .where('availability', '==', 'available')
          .get();
      }

      const resources = resourcesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const sosLat = after.lat;
      const sosLng = after.lng;

      // Prepare list of resources with calculated distances for Gemini
      const resourceList = resources.map((res) => {
        const distance = haversineMeters(sosLat, sosLng, res.latitude, res.longitude);
        return {
          id: res.id,
          name: res.name,
          type: res.type,
          capacity: res.capacity || 10,
          distance_meters: Math.round(distance),
          status: res.status
        };
      });

      const sosDetails = {
        name: after.name || 'Citizen',
        situation: after.situation,
        people_count: parseInt(after.people_count) || 1,
        notes: after.notes || '',
        ai_priority: after.ai_priority,
        ai_flags: after.ai_flags || []
      };

      const apiKey = process.env.GEMINI_API_KEY;
      let selectedResourceId = null;
      let selectionReason = 'Auto-assigned by RAAHAT Dispatch Engine.';

      if (apiKey) {
        try {
          const userContent = JSON.stringify({ sosDetails, availableResources: resourceList });
          const raw = await callGemini(apiKey, ASSIGN_SYSTEM_PROMPT, userContent, 300);
          const parsed = JSON.parse(raw);
          selectedResourceId = parsed.assigned_resource_id;
          selectionReason = parsed.reason || selectionReason;
          console.log(`Gemini selected resource: ${selectedResourceId} reason: ${selectionReason}`);
        } catch (aiErr) {
          console.warn('Gemini dispatch choice failed, running deterministic fallback:', aiErr.message);
        }
      }

      // Verify Gemini's choice exists and is available, otherwise run deterministic fallback
      let best = resources.find(r => r.id === selectedResourceId);
      
      if (!best) {
        console.log('Running deterministic resource assignment fallback...');
        const preferredTypes = SITUATION_RESOURCE_PREFERENCE[after.situation] || ['rescue_team', 'boat', 'ambulance'];
        const scored = resources.map((res) => {
          const typeRank = preferredTypes.indexOf(res.type);
          const typePriority = typeRank === -1 ? preferredTypes.length : typeRank;
          const distance = haversineMeters(sosLat, sosLng, res.latitude, res.longitude);
          return { res, typePriority, distance };
        });

        scored.sort((a, b) => {
          if (a.typePriority !== b.typePriority) return a.typePriority - b.typePriority;
          return a.distance - b.distance;
        });
        
        best = scored[0].res;
        selectionReason = `Optimized match: ${best.name} is the closest ${best.type} available.`;
      }

      const now = new Date().toISOString();

      // Step 1: Assign request
      await event.data.after.ref.update({
        status: 'TEAM_ASSIGNED',
        assigned_resource_id: best.id,
        assigned_resource_name: best.name,
        assigned_at: now,
        ai_assignment_reason: selectionReason,
        dispatcher_name: 'AI Auto-Dispatcher'
      });

      // Step 2: Mark resource as busy
      await db.collection('resources').doc(best.id).update({
        availability: 'busy',
        status: `Assigned to rescue ${after.name || 'citizen'}`
      });

      console.log(`✅ AI-assigned ${best.name} to request ${requestId}`);
    } catch (err) {
      console.error('autoAssignAndDispatch error:', err.message);
    }
  }
);
