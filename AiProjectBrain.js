/**
 * AiProjectBrain.js - EHOME PROJECT BRAIN V4.22.2
 * Compact, stable project context injected into OpenAI prompts.
 * No secrets. No customer PII. No live values that can go stale quickly.
 */
var EHOME_AI_PROJECT_BRAIN_V4222 = {
  VERSION: "4.22.2-project-brain",
  TEXT: [
    "EHOME Booking production context:",
    "- Source of truth: Google Sheet NÂNG CẤP MASTER + Apps Script live. Do not treat old backup/ZIP/master copies as production truth.",
    "- Scale: about 150 source sheets and roughly 1,000+ villas/rooms. Accuracy of availability is more important than speed.",
    "- Identity: MÃ_CĂN is durable. Never reassign/steal an ID because a column moved or a villa name changed.",
    "- Reconcile safety: source read failure, abnormal zero, parser mismatch, or unconfirmed structure must preserve old MASTER_VILLA. Removal requires confirmed structure evidence.",
    "- Search: PHONG_RIENG and NGUYEN_CAN are both valid product types. Private-room search must keep PHONG_RIENG high recall. Capacity may be a range such as 8-10; do not collapse it to one misleading number.",
    "- Capacity safety: bedrooms 1..30, capacity 1..100. Never infer guests from price/WC/address. Bungalow/independent sleeping space may count as one bedroom when source evidence says so.",
    "- Price policy: never auto-write source prices. Price changes are review/approval work; bulk unexpected changes must be alerted, not silently applied.",
    "- Calendar policy: hidden/old month sheets are skipped by design. FREE/BUSY and price conclusions require calendar/search evidence, not AI guesses.",
    "- AI Config: manual-only. Health Watch may alert but must not call OpenAI by itself. AI proposes; code validates; admin presses Telegram approval before writes.",
    "- AI writes are limited: CONFIG/LOẠI through applyAiConfigProposalV1; PN/khách through applyAiVillaCorrectionsV1. Do not modify price, booking calendar, MÃ_CĂN, or mass-delete villas.",
    "- When current source has 0 villas or structural uncertainty, treat it as high risk. Require stronger parser confirmation before CONFIG write.",
    "- Operational style: prefer targeted source reads and incremental repair; do not rebuild all production unless explicitly required."
  ].join("\n")
};

function aiProjectBrainV4222_(){
  return EHOME_AI_PROJECT_BRAIN_V4222.TEXT;
}

function aiProjectBrainVersionV4222_(){
  return EHOME_AI_PROJECT_BRAIN_V4222.VERSION;
}

function testAiProjectBrainV4222(){
  var text=aiProjectBrainV4222_();
  var required=["NÂNG CẤP MASTER","MÃ_CĂN","PHONG_RIENG","Capacity","manual-only","0 villas"];
  required.forEach(function(token){if(text.indexOf(token)<0)throw new Error("PROJECT_BRAIN_MISSING_V4222: "+token);});
  var result={success:true,version:aiProjectBrainVersionV4222_(),chars:text.length,rules:required.length};
  Logger.log(JSON.stringify({code:"AI_PROJECT_BRAIN_PASS_V4222",result:result}));
  return result;
}
