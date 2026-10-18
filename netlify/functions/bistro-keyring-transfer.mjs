// Observe provider-injected routing metadata only. This does not authorize it.
const SITE = '65a8739e-607f-4a2a-a0f0-618731a921d3';
export function inspectOrigin(env, context, globalContext) {
  try {
    if (context?.site?.id !== SITE || context.deploy?.context !== 'production' ||
        context.deploy.published !== true || !/^[a-f0-9]{24}$/.test(context.deploy.id))
      return {stage: 'HOST_MISMATCH', ok: false};
    const raw = globalContext ?? env.NETLIFY_BLOBS_CONTEXT;
    if (typeof raw !== 'string' || raw.length > 32768)
      return {stage: 'BLOBS_CONTEXT_UNAVAILABLE', ok: false};
    const c = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!c || typeof c !== 'object' || Array.isArray(c) || c.siteID !== SITE)
      return {stage: 'BLOBS_SITE_REJECTED', ok: false};
    if (typeof c.uncachedEdgeURL !== 'string' || c.uncachedEdgeURL.length > 2048)
      return {stage: 'BLOBS_STRONG_ORIGIN_UNAVAILABLE', ok: false};
    const u = new URL(c.uncachedEdgeURL);
    const labels = u.hostname.split('.');
    if (u.protocol !== 'https:' || u.username || u.password || u.port ||
        u.hostname.length > 253 || labels.length < 2 ||
        !labels.every(x => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x)) ||
        /^[0-9.]+$/.test(u.hostname))
      return {stage: 'BLOBS_ORIGIN_SHAPE_REJECTED', ok: false};
    return {stage: 'ORIGIN_OBSERVED_NOT_AUTHORIZED', ok: false, siteID: SITE,
      deploymentID: context.deploy.id, nodeVersion: process.versions.node,
      observedStrongOrigin: u.origin, keyringRead: false, blobIO: false,
      externalRequests: 0, writes: 0};
  } catch {
    return {stage: 'HOST_METADATA_PARSE_FAILED', ok: false};
  }
}
export const config = {schedule: '0 0 1 1 *'};
export default async (_request, context) => {
  console.log(JSON.stringify(inspectOrigin(process.env, context, globalThis.netlifyBlobsContext)));
};
