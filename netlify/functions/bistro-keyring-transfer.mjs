// outputs/keyring-b-implementation/core/host-inspection.mjs
function inspectHost(env, hostContext) {
  try {
    if (hostContext?.site?.id !== "65a8739e-607f-4a2a-a0f0-618731a921d3" || hostContext.deploy?.context !== "production" || hostContext.deploy.published !== true || typeof hostContext.deploy.id !== "string") return { stage: "HOST_MISMATCH", ok: false };
    const raw = globalThis.netlifyBlobsContext ?? env.NETLIFY_BLOBS_CONTEXT;
    if (typeof raw !== "string" || raw.length > 32768) return { stage: "BLOBS_CONTEXT_UNAVAILABLE", ok: false };
    const c = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    const u = new URL(c.uncachedEdgeURL);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.endsWith(".blobs.netlify.com") || c.siteID !== hostContext.site.id) return { stage: "BLOBS_ORIGIN_REVIEW_REQUIRED", ok: false };
    return { stage: "HOST_METADATA_ONLY", ok: true, siteID: hostContext.site.id, deploymentID: hostContext.deploy.id, blobsOrigin: u.origin, nodeVersion: process.versions.node };
  } catch {
    return { stage: "HOST_METADATA_UNAVAILABLE", ok: false };
  }
}

// outputs/keyring-b-implementation/host-inspection.mjs
var config = { schedule: "0 0 1 1 *" };
var host_inspection_default = async (request, context) => {
  console.log(JSON.stringify(inspectHost(process.env, context)));
};
export {
  config,
  host_inspection_default as default
};
