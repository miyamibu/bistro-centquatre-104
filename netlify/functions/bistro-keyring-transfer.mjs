// ../../../../2026-10-16/pin-bistro-cloudflare/outputs/keyring-b-implementation/diagnostics-v2/host-inspection.mjs
var SITE = "65a8739e-607f-4a2a-a0f0-618731a921d3";
function inspectHost(env, context, globalContext) {
  try {
    if (context?.site?.id !== SITE || context.deploy?.context !== "production" || context.deploy.published !== true || typeof context.deploy.id !== "string") return { stage: "HOST_MISMATCH", ok: false };
    const raw = globalContext ?? env.NETLIFY_BLOBS_CONTEXT;
    if (typeof raw !== "string" || raw.length > 32768) return { stage: "BLOBS_CONTEXT_UNAVAILABLE", ok: false };
    const c = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (!c || typeof c !== "object" || Array.isArray(c)) return { stage: "BLOBS_CONTEXT_SHAPE_REJECTED", ok: false };
    const present = Object.hasOwn(c, "siteID");
    const out = { stage: "BLOBS_METADATA_OBSERVED_REQUIRES_REVIEW", ok: false, siteID: SITE, deploymentID: context.deploy.id, nodeVersion: process.versions.node, siteIDPresent: present, siteIDMatches: present ? c.siteID === SITE : null, strongOriginPresent: typeof c.uncachedEdgeURL === "string" };
    if (!out.strongOriginPresent) return out;
    if (c.uncachedEdgeURL.length > 2048) return { ...out, originState: "LENGTH_REJECTED" };
    const u = new URL(c.uncachedEdgeURL);
    out.https = u.protocol === "https:";
    out.userinfoAbsent = !u.username && !u.password;
    out.hostCategory = u.hostname === "blobs.netlify.com" ? "BLOBS_BASE" : u.hostname.endsWith(".blobs.netlify.com") ? "BLOBS_SUBDOMAIN" : u.hostname.endsWith(".netlify.com") ? "NETLIFY_FIRST_PARTY_OTHER" : "UNRECOGNIZED";
    if (out.https && out.userinfoAbsent && out.hostCategory !== "UNRECOGNIZED") out.blobsOrigin = u.origin;
    return out;
  } catch {
    return { stage: "HOST_METADATA_PARSE_FAILED", ok: false };
  }
}
var config = { schedule: "0 0 1 1 *" };
var host_inspection_default = async (request, context) => {
  console.log(JSON.stringify(inspectHost(process.env, context, globalThis.netlifyBlobsContext)));
};
export {
  config,
  host_inspection_default as default,
  inspectHost
};
