// ../../../../.npm/_npx/b3ca12a867cd0704/node_modules/@netlify/runtime-utils/dist/main.js
var getString = (input) => typeof input === "string" ? input : JSON.stringify(input);
var base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input);
var base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input));
var getEnvironment = () => {
  const { Deno, Netlify, process: process2 } = globalThis;
  return Netlify?.env ?? Deno?.env ?? {
    delete: (key) => delete process2?.env[key],
    get: (key) => process2?.env[key],
    has: (key) => Boolean(process2?.env[key]),
    set: (key, value) => {
      if (process2?.env) {
        process2.env[key] = value;
      }
    },
    toObject: () => process2?.env ?? {}
  };
};

// ../../../../.npm/_npx/b3ca12a867cd0704/node_modules/@netlify/otel/dist/main.js
var GET_TRACER = "__netlify__getTracer";
var getTracer = (name, version) => {
  return globalThis[GET_TRACER]?.(name, version);
};
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  const func = typeof contextOrFn === "function" ? contextOrFn : typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!func) {
    throw new Error("function to execute with active span is missing");
  }
  if (!tracer) {
    return func();
  }
  return tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func);
}

// ../../../../.npm/_npx/b3ca12a867cd0704/node_modules/@netlify/blobs/dist/chunk-FWVYH726.js
var getEnvironmentContext = () => {
  const context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
  if (typeof context !== "string" || !context) {
    return {};
  }
  const data = base64Decode(context);
  try {
    return JSON.parse(data);
  } catch {
  }
  return {};
};
var MissingBlobsEnvironmentError = class extends Error {
  constructor(requiredProperties) {
    super(
      `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
        ", "
      )}`
    );
    this.name = "MissingBlobsEnvironmentError";
  }
};
var BASE64_PREFIX = "b64;";
var METADATA_HEADER_INTERNAL = "x-amz-meta-user";
var METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
var METADATA_MAX_SIZE = 2 * 1024;
var encodeMetadata = (metadata) => {
  if (!metadata) {
    return null;
  }
  const encodedObject = base64Encode(JSON.stringify(metadata));
  const payload = `b64;${encodedObject}`;
  if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE) {
    throw new Error("Metadata object exceeds the maximum size");
  }
  return payload;
};
var decodeMetadata = (header) => {
  if (!header?.startsWith(BASE64_PREFIX)) {
    return {};
  }
  const encodedData = header.slice(BASE64_PREFIX.length);
  const decodedData = base64Decode(encodedData);
  const metadata = JSON.parse(decodedData);
  return metadata;
};
var getMetadataFromResponse = (response) => {
  if (!response.headers) {
    return {};
  }
  const value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
  try {
    return decodeMetadata(value);
  } catch {
    throw new Error(
      "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
    );
  }
};
var NF_ERROR = "x-nf-error";
var NF_REQUEST_ID = "x-nf-request-id";
var DEPLOY_STORE_PREFIX = "deploy:";
var SITE_STORE_PREFIX = "site:";
var isDeniedWrite = (res, { method, storeName }) => (res.status === 401 || res.status === 403) && (method === "put" || method === "delete") && storeName !== void 0 && !storeName.startsWith(DEPLOY_STORE_PREFIX);
var blobsErrorMessage = (res, context) => {
  let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
  if (res.headers.has(NF_REQUEST_ID)) {
    details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`;
  }
  if (isDeniedWrite(res, context)) {
    const storeName = context.storeName?.startsWith(SITE_STORE_PREFIX) ? context.storeName.slice(SITE_STORE_PREFIX.length) : context.storeName;
    return `Netlify Blobs could not write to store '${storeName}' (${details}). Builds and build plugins can only write to deploy-specific stores: use 'getDeployStore' instead of 'getStore', or pass a 'token' with write access to the store. If this code is not running in a build, check that the token and site ID are valid. See https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores`;
  }
  return `Netlify Blobs has generated an internal error (${details})`;
};
var BlobsInternalError = class extends Error {
  constructor(res, context = {}) {
    super(blobsErrorMessage(res, context));
    this.name = "BlobsInternalError";
  }
};
var collectIterator = async (iterator) => {
  const result = [];
  for await (const item of iterator) {
    result.push(item);
  }
  return result;
};
function withSpan(span, name, fn) {
  if (span) return fn(span);
  return withActiveSpan(getTracer(), name, (span2) => {
    return fn(span2);
  });
}
var BlobsConsistencyError = class extends Error {
  constructor() {
    super(
      `Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property`
    );
    this.name = "BlobsConsistencyError";
  }
};
var regions = {
  "us-east-1": true,
  "us-east-2": true,
  "eu-central-1": true,
  "ap-southeast-1": true,
  "ap-southeast-2": true
};
var isValidRegion = (input) => Object.keys(regions).includes(input);
var InvalidBlobsRegionError = class extends Error {
  constructor(region) {
    super(
      `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
    );
    this.name = "InvalidBlobsRegionError";
  }
};
var DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3;
var MIN_RETRY_DELAY = 1e3;
var MAX_RETRY = 5;
var RATE_LIMIT_HEADER = "X-RateLimit-Reset";
var fetchAndRetry = async (fetch, url, options, attemptsLeft = MAX_RETRY) => {
  try {
    const res = await fetch(url, options);
    if (attemptsLeft > 0 && (res.status === 429 || res.status >= 500)) {
      const delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
      await sleep(delay);
      return fetchAndRetry(fetch, url, options, attemptsLeft - 1);
    }
    return res;
  } catch (error) {
    if (attemptsLeft === 0) {
      throw error;
    }
    const delay = getDelay();
    await sleep(delay);
    return fetchAndRetry(fetch, url, options, attemptsLeft - 1);
  }
};
var getDelay = (rateLimitReset) => {
  if (!rateLimitReset) {
    return DEFAULT_RETRY_DELAY;
  }
  return Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY);
};
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
var SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url";
var Client = class {
  constructor({ apiURL, consistency, edgeURL, fetch, region, siteID, token, uncachedEdgeURL }) {
    this.apiURL = apiURL;
    this.consistency = consistency ?? "eventual";
    this.edgeURL = edgeURL;
    this.fetch = fetch ?? globalThis.fetch;
    this.region = region;
    this.siteID = siteID;
    this.token = token;
    this.uncachedEdgeURL = uncachedEdgeURL;
    if (!this.fetch) {
      throw new Error(
        "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
      );
    }
  }
  async getFinalRequest({
    consistency: opConsistency,
    key,
    metadata,
    method,
    parameters = {},
    storeName
  }) {
    const encodedMetadata = encodeMetadata(metadata);
    const consistency = opConsistency ?? this.consistency;
    let urlPath = `/${this.siteID}`;
    if (storeName) {
      urlPath += `/${storeName}`;
    }
    if (key) {
      urlPath += `/${key}`;
    }
    if (this.edgeURL) {
      if (consistency === "strong" && !this.uncachedEdgeURL) {
        throw new BlobsConsistencyError();
      }
      const headers = {
        authorization: `Bearer ${this.token}`
      };
      if (encodedMetadata) {
        headers[METADATA_HEADER_INTERNAL] = encodedMetadata;
      }
      if (this.region) {
        urlPath = `/region:${this.region}${urlPath}`;
      }
      const url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
      for (const key2 in parameters) {
        url2.searchParams.set(key2, parameters[key2]);
      }
      return {
        headers,
        url: url2.toString()
      };
    }
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
    for (const key2 in parameters) {
      url.searchParams.set(key2, parameters[key2]);
    }
    if (this.region) {
      url.searchParams.set("region", this.region);
    }
    if (storeName === void 0 || key === void 0) {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    if (encodedMetadata) {
      apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata;
    }
    if (method === "head" || method === "delete") {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    const res = await this.fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
      method
    });
    if (res.status !== 200) {
      throw new BlobsInternalError(res, { method, storeName });
    }
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0;
    return {
      headers: userHeaders,
      url: signedURL
    };
  }
  async makeRequest({
    body,
    conditions = {},
    consistency,
    headers: extraHeaders,
    key,
    metadata,
    method,
    parameters,
    storeName
  }) {
    const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
      consistency,
      key,
      metadata,
      method,
      parameters,
      storeName
    });
    const headers = {
      ...baseHeaders,
      ...extraHeaders
    };
    if (method === "put") {
      headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    if ("onlyIfMatch" in conditions && conditions.onlyIfMatch) {
      headers["if-match"] = conditions.onlyIfMatch;
    } else if ("onlyIfNew" in conditions && conditions.onlyIfNew) {
      headers["if-none-match"] = "*";
    }
    const options = {
      body,
      headers,
      method
    };
    if (body instanceof ReadableStream) {
      options.duplex = "half";
    }
    return fetchAndRetry(this.fetch, url, options);
  }
};
var getClientOptions = (options, contextOverride) => {
  const context = contextOverride ?? getEnvironmentContext();
  const siteID = context.siteID ?? options.siteID;
  const token = context.token ?? options.token;
  if (!siteID || !token) {
    throw new MissingBlobsEnvironmentError(["siteID", "token"]);
  }
  if (options.region !== void 0 && !isValidRegion(options.region)) {
    throw new InvalidBlobsRegionError(options.region);
  }
  const clientOptions = {
    apiURL: context.apiURL ?? options.apiURL,
    consistency: options.consistency,
    edgeURL: context.edgeURL ?? options.edgeURL,
    fetch: options.fetch,
    region: options.region,
    siteID,
    token,
    uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
  };
  return clientOptions;
};

// ../../../../.npm/_npx/b3ca12a867cd0704/node_modules/@netlify/blobs/dist/main.js
var LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/";
var STATUS_OK = 200;
var STATUS_PRE_CONDITION_FAILED = 412;
var Store = class _Store {
  constructor(options) {
    this.client = options.client;
    if ("deployID" in options) {
      _Store.validateDeployID(options.deployID);
      let name = DEPLOY_STORE_PREFIX + options.deployID;
      if (options.name) {
        name += `:${options.name}`;
      }
      this.name = name;
    } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
      const storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
      _Store.validateStoreName(storeName);
      this.name = storeName;
    } else {
      _Store.validateStoreName(options.name);
      this.name = SITE_STORE_PREFIX + options.name;
    }
  }
  async delete(key) {
    const res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
    if (![200, 204, 404].includes(res.status)) {
      throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
    }
  }
  async deleteAll() {
    let totalDeletedBlobs = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.client.makeRequest({ method: "delete", storeName: this.name });
      if (res.status !== 200) {
        throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
      }
      const data = await res.json();
      if (typeof data.blobs_deleted !== "number") {
        throw new BlobsInternalError(res);
      }
      totalDeletedBlobs += data.blobs_deleted;
      hasMore = typeof data.has_more === "boolean" && data.has_more;
    }
    return {
      deletedBlobs: totalDeletedBlobs
    };
  }
  async get(key, options) {
    return withSpan(options?.span, "blobs.get", async (span) => {
      const { consistency, type } = options ?? {};
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.type": type,
        "blobs.method": "GET",
        "blobs.consistency": consistency
      });
      const res = await this.client.makeRequest({
        consistency,
        key,
        method: "get",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        throw new BlobsInternalError(res);
      }
      if (type === void 0 || type === "text") {
        return res.text();
      }
      if (type === "arrayBuffer") {
        return res.arrayBuffer();
      }
      if (type === "blob") {
        return res.blob();
      }
      if (type === "json") {
        return res.json();
      }
      if (type === "stream") {
        return res.body;
      }
      throw new BlobsInternalError(res);
    });
  }
  async getMetadata(key, options = {}) {
    return withSpan(options?.span, "blobs.getMetadata", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "HEAD",
        "blobs.consistency": options.consistency
      });
      const res = await this.client.makeRequest({
        consistency: options.consistency,
        key,
        method: "head",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const etag = res?.headers.get("etag") ?? void 0;
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag,
        metadata
      };
      return result;
    });
  }
  async getWithMetadata(key, options) {
    return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
      const { consistency, etag: requestETag, type } = options ?? {};
      const headers = requestETag ? { "if-none-match": requestETag } : void 0;
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "GET",
        "blobs.consistency": options?.consistency,
        "blobs.type": type,
        "blobs.request.etag": requestETag
      });
      const res = await this.client.makeRequest({
        consistency,
        headers,
        key,
        method: "get",
        storeName: this.name
      });
      const responseETag = res?.headers.get("etag") ?? void 0;
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.etag": responseETag,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag: responseETag,
        metadata
      };
      if (res.status === 304 && requestETag) {
        return { data: null, ...result };
      }
      if (type === void 0 || type === "text") {
        return { data: await res.text(), ...result };
      }
      if (type === "arrayBuffer") {
        return { data: await res.arrayBuffer(), ...result };
      }
      if (type === "blob") {
        return { data: await res.blob(), ...result };
      }
      if (type === "json") {
        return { data: await res.json(), ...result };
      }
      if (type === "stream") {
        return { data: res.body, ...result };
      }
      throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
    });
  }
  list(options = {}) {
    return withSpan(options.span, "blobs.list", (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.method": "GET",
        "blobs.list.paginate": options.paginate ?? false
      });
      const iterator = this.getListIterator(options);
      if (options.paginate) {
        return iterator;
      }
      return collectIterator(iterator).then(
        (items) => items.reduce(
          (acc, item) => ({
            blobs: [...acc.blobs, ...item.blobs],
            directories: [...acc.directories, ...item.directories]
          }),
          { blobs: [], directories: [] }
        )
      );
    });
  }
  async set(key, data, options = {}) {
    return withSpan(options.span, "blobs.set", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
        "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const res = await this.client.makeRequest({
        conditions,
        body: data,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  async setJSON(key, data, options = {}) {
    return withSpan(options.span, "blobs.setJSON", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.type": "json",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const payload = JSON.stringify(data);
      const headers = {
        "content-type": "application/json"
      };
      const res = await this.client.makeRequest({
        conditions,
        body: payload,
        headers,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  static formatListResultBlob(result) {
    if (!result.key) {
      return null;
    }
    return {
      etag: result.etag,
      key: result.key
    };
  }
  static getConditions(options) {
    if ("onlyIfMatch" in options && "onlyIfNew" in options) {
      throw new Error(
        `The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key.`
      );
    }
    if ("onlyIfMatch" in options && options.onlyIfMatch) {
      if (typeof options.onlyIfMatch !== "string") {
        throw new Error(`The 'onlyIfMatch' property expects a string representing an ETag.`);
      }
      return {
        onlyIfMatch: options.onlyIfMatch
      };
    }
    if ("onlyIfNew" in options && options.onlyIfNew) {
      if (typeof options.onlyIfNew !== "boolean") {
        throw new Error(
          `The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists.`
        );
      }
      return {
        onlyIfNew: true
      };
    }
  }
  static validateKey(key) {
    if (key === "") {
      throw new Error("Blob key must not be empty.");
    }
    if (key.startsWith("/") || key.startsWith("%2F")) {
      throw new Error("Blob key must not start with forward slash (/).");
    }
    if (new TextEncoder().encode(key).length > 600) {
      throw new Error(
        "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
      );
    }
  }
  static validateDeployID(deployID) {
    if (!/^\w{1,24}$/.test(deployID)) {
      throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
    }
  }
  static validateStoreName(name) {
    if (name.includes("/") || name.includes("%2F")) {
      throw new Error("Store name must not contain forward slashes (/).");
    }
    if (new TextEncoder().encode(name).length > 64) {
      throw new Error(
        "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
      );
    }
  }
  getListIterator(options) {
    const { client, name: storeName } = this;
    const parameters = {};
    if (options?.prefix) {
      parameters.prefix = options.prefix;
    }
    if (options?.directories) {
      parameters.directories = "true";
    }
    return {
      [Symbol.asyncIterator]() {
        let currentCursor = null;
        let done = false;
        return {
          async next() {
            return withSpan(options?.span, "blobs.list.next", async (span) => {
              span?.setAttributes({
                "blobs.store": storeName,
                "blobs.method": "GET",
                "blobs.list.paginate": options?.paginate ?? false,
                "blobs.list.done": done,
                "blobs.list.cursor": currentCursor ?? void 0
              });
              if (done) {
                return { done: true, value: void 0 };
              }
              const nextParameters = { ...parameters };
              if (currentCursor !== null) {
                nextParameters.cursor = currentCursor;
              }
              const res = await client.makeRequest({
                method: "get",
                parameters: nextParameters,
                storeName
              });
              span?.setAttributes({
                "blobs.response.status": res.status
              });
              let blobs = [];
              let directories = [];
              if (![200, 204, 404].includes(res.status)) {
                throw new BlobsInternalError(res);
              }
              if (res.status === 404) {
                done = true;
              } else {
                const page = await res.json();
                if (page.next_cursor) {
                  currentCursor = page.next_cursor;
                } else {
                  done = true;
                }
                blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean);
                directories = page.directories ?? [];
              }
              return {
                done: false,
                value: {
                  blobs,
                  directories
                }
              };
            });
          }
        };
      }
    };
  }
};
var getStore = (input, options) => {
  if (typeof input === "string") {
    const contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0;
    const clientOptions = getClientOptions(options ?? {}, contextOverride);
    const client = new Client(clientOptions);
    return new Store({ client, name: input });
  }
  if (typeof input?.name === "string") {
    const { name } = input;
    const contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0;
    const clientOptions = getClientOptions(input, contextOverride);
    if (!name) {
      throw new MissingBlobsEnvironmentError(["name"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, name });
  }
  if (typeof input?.deployID === "string") {
    const clientOptions = getClientOptions(input);
    const { deployID } = input;
    if (!deployID) {
      throw new MissingBlobsEnvironmentError(["deployID"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, deployID });
  }
  throw new Error(
    "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
  );
};

// outputs/keyring-b-encrypted-relay-20261019/source/source.mjs
import { createHash as createHash2, randomBytes, webcrypto } from "node:crypto";

// outputs/keyring-b-implementation/ledger/ledger.mjs
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
var STAGES = Object.freeze([
  "CLAIMED",
  "SEND_STARTED",
  "VERSION_PREPARED",
  "VERIFIED",
  "CLOSED",
  "CLAIM_UNKNOWN",
  "TRANSFER_UNKNOWN",
  "STOPPED"
]);
var manifestKeys = [
  "siteID",
  "sourceGeneration",
  "operationID",
  "destination",
  "deploymentID",
  "functionName",
  "sourceMetadataVersion",
  "notBeforeMs",
  "startDeadlineMs",
  "deadlineMs",
  "cleanupReserveMs"
];
var destinationKeys = ["accountID", "workerName", "secretName"];
var runtimeKeys = manifestKeys.slice(0, 7);
var versionOK = (value) => typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
var textOK = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
var plain = (value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
var exactKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
var snapshot = (value) => structuredClone(value);
function validDestination(value) {
  return exactKeys(value, destinationKeys) && destinationKeys.every((key) => textOK(value[key]));
}
function validManifest(value) {
  if (!exactKeys(value, manifestKeys) || !validDestination(value.destination)) return false;
  if (!runtimeKeys.filter((key) => key !== "destination").every((key) => textOK(value[key]))) return false;
  if (!manifestKeys.slice(7).every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)) return false;
  return value.notBeforeMs < value.startDeadlineMs && value.startDeadlineMs < value.deadlineMs && value.cleanupReserveMs > 0 && value.startDeadlineMs <= value.deadlineMs - value.cleanupReserveMs;
}
function canonicalIdentity(manifest) {
  if (!validManifest(manifest)) throw new TypeError("INVALID_MANIFEST");
  const { destination } = manifest;
  return createHash("sha256").update(JSON.stringify([
    "bistro-keyring-ledger-v1",
    manifest.siteID,
    manifest.sourceGeneration,
    destination.accountID,
    destination.workerName,
    destination.secretName,
    manifest.operationID
  ]), "utf8").digest("hex");
}
function createOneShotLedger({ manifest, store, now, randomNonce, audit } = {}) {
  if (!validManifest(manifest) || typeof now !== "function" || typeof randomNonce !== "function" || !store || !["read", "create", "cas"].every((key) => typeof store[key] === "function") || audit !== void 0 && typeof audit !== "function") throw new TypeError("INVALID_CONFIGURATION");
  const policy = snapshot(manifest);
  const identity = canonicalIdentity(policy);
  let record;
  let etag;
  let busy = false;
  let halted = false;
  let claimAttempted = false;
  function result(stage, ok = false, versionID) {
    const value = { stage, ok };
    if (versionOK(versionID)) value.versionID = versionID;
    if (audit) {
      try {
        audit(snapshot(value));
      } catch {
      }
    }
    return Object.freeze(value);
  }
  function stop(stage = "STOPPED") {
    halted = true;
    return result(stage);
  }
  function runtimeMatches(context) {
    if (!plain(context) || Object.keys(context).some((key) => ![...runtimeKeys, "baselinePresent", "rotationFrozen", "runID"].includes(key))) return false;
    return runtimeKeys.every((key) => isDeepStrictEqual(context[key], policy[key])) && context.baselinePresent === true && context.rotationFrozen === true && (!Object.hasOwn(context, "runID") || textOK(context.runID));
  }
  function inWindow(kind) {
    const time = now();
    if (!Number.isSafeInteger(time) || time < policy.notBeforeMs) return false;
    if (kind === "cleanup") return true;
    return time < (kind === "send" ? policy.startDeadlineMs : policy.deadlineMs);
  }
  async function readOwn(expected, previousETag) {
    const found = await store.read(identity, { consistency: "strong" });
    if (!exactKeys(found, ["record", "etag"]) || !textOK(found.etag) || found.etag === previousETag || !isDeepStrictEqual(found.record, expected)) return false;
    record = snapshot(found.record);
    etag = found.etag;
    return true;
  }
  async function transition(stage, versionID) {
    const previousETag = etag;
    const next = { ...snapshot(record), stage, revision: record.revision + 1 };
    if (versionID !== void 0) next.versionID = versionID;
    let written;
    try {
      written = await store.cas(identity, snapshot(next), { onlyIfMatch: etag });
    } catch {
      return "unknown";
    }
    if (!exactKeys(written, ["modified"]) || typeof written.modified !== "boolean") return "unknown";
    if (!written.modified) return "conflict";
    try {
      return await readOwn(next, previousETag) ? "ok" : "conflict";
    } catch {
      return "unknown";
    }
  }
  async function guarded2(action, unknownStage = "STOPPED") {
    if (busy || halted) return result("STOPPED");
    busy = true;
    try {
      return await action();
    } catch {
      return stop(unknownStage);
    } finally {
      busy = false;
    }
  }
  async function claim(context) {
    return guarded2(async () => {
      if (claimAttempted || record || !runtimeMatches(context) || !inWindow("send")) return stop();
      claimAttempted = true;
      const nonce = randomNonce();
      if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce)) return stop();
      const initial = {
        schemaVersion: 1,
        identity,
        manifest: snapshot(policy),
        ownerNonce: nonce,
        stage: "CLAIMED",
        revision: 0
      };
      let written;
      try {
        written = await store.create(identity, snapshot(initial), { onlyIfNew: true });
      } catch {
        return stop("CLAIM_UNKNOWN");
      }
      if (!exactKeys(written, ["modified"]) || typeof written.modified !== "boolean") {
        return stop("CLAIM_UNKNOWN");
      }
      if (!written.modified) return stop();
      try {
        if (!await readOwn(initial)) return stop();
      } catch {
        return stop("CLAIM_UNKNOWN");
      }
      if (!runtimeMatches(context) || !inWindow("send")) return stop();
      return result("CLAIMED", true);
    }, "CLAIM_UNKNOWN");
  }
  async function sendOnce(context, sender) {
    return guarded2(async () => {
      if (!record || record.stage !== "CLAIMED" || typeof sender !== "function" || !runtimeMatches(context) || !inWindow("send")) return stop();
      const started = await transition("SEND_STARTED");
      if (started !== "ok") return stop(started === "unknown" ? "TRANSFER_UNKNOWN" : "STOPPED");
      if (!runtimeMatches(context) || !inWindow("send")) return stop();
      let response;
      try {
        response = await sender();
      } catch {
        await transition("TRANSFER_UNKNOWN");
        return stop("TRANSFER_UNKNOWN");
      }
      if (!exactKeys(response, ["confirmed", "versionID"]) || response.confirmed !== true || !versionOK(response.versionID) || !runtimeMatches(context) || !inWindow("proof")) {
        await transition("TRANSFER_UNKNOWN");
        return stop("TRANSFER_UNKNOWN");
      }
      const prepared = await transition("VERSION_PREPARED", response.versionID);
      if (prepared !== "ok") return stop("TRANSFER_UNKNOWN");
      return result("VERSION_PREPARED", true, record.versionID);
    }, "TRANSFER_UNKNOWN");
  }
  async function verify(context, proof) {
    return guarded2(async () => {
      const keys = [
        "versionID",
        "sourceGeneration",
        "sourceMetadataVersion",
        "exactVersionPrivateTransport",
        "allKeyIDsMatched",
        "baselinePreserved"
      ];
      if (!record || record.stage !== "VERSION_PREPARED" || !runtimeMatches(context) || !inWindow("proof") || !exactKeys(proof, keys) || proof.versionID !== record.versionID || proof.sourceGeneration !== policy.sourceGeneration || proof.sourceMetadataVersion !== policy.sourceMetadataVersion || proof.exactVersionPrivateTransport !== true || proof.allKeyIDsMatched !== true || proof.baselinePreserved !== true) {
        if (record?.stage === "VERSION_PREPARED") await transition("TRANSFER_UNKNOWN");
        return stop("TRANSFER_UNKNOWN");
      }
      if (await transition("VERIFIED") !== "ok") return stop("TRANSFER_UNKNOWN");
      if (!runtimeMatches(context) || !inWindow("proof")) {
        await transition("TRANSFER_UNKNOWN");
        return stop("TRANSFER_UNKNOWN");
      }
      return result("VERIFIED", true, record.versionID);
    }, "TRANSFER_UNKNOWN");
  }
  async function close(context, cleanup) {
    return guarded2(async () => {
      const keys = [
        "credentialRevoked",
        "temporaryCredentialRemoved",
        "functionRemoved",
        "scheduleRemoved",
        "cleanupReadback"
      ];
      if (!record || record.stage !== "VERIFIED" || !runtimeMatches(context) || !inWindow("cleanup") || !exactKeys(cleanup, keys) || !keys.every((key) => cleanup[key] === true)) {
        return stop();
      }
      if (await transition("CLOSED") !== "ok") return stop("TRANSFER_UNKNOWN");
      return result("CLOSED", true, record.versionID);
    }, "TRANSFER_UNKNOWN");
  }
  return Object.freeze({ identity, claim, sendOnce, verify, close });
}

// outputs/keyring-b-encrypted-relay-20261019/capsule.mjs
var TTL = 45 * 60 * 1e3;
var SOURCE_START_WINDOW = 15 * 60 * 1e3;
var LANES = Object.freeze({
  "public-synthetic": ["bistro-b-0c4e53521a504f6382b4dd07eb5b5a12", "public-synthetic-v1"],
  "existing-keyring": ["bistro-b-8c541600447a4167b70f5149fe6548de", "netlify-6ad1bda7446a63df744c9a30-frozen"]
});
var enc = new TextEncoder();

// outputs/keyring-b-encrypted-relay-20261019/capsule-v2.mjs
var MAX = 65536;
var TTL2 = 45 * 60 * 1e3;
var SOURCE_START_WINDOW2 = 15 * 60 * 1e3;
var VERSION = "bistro-keyring-capsule-v2";
var SITE = "65a8739e-607f-4a2a-a0f0-618731a921d3";
var DEST = "1af5e701fec4bbef3fd3b81379e6cc73/bistro-independent-outbox-candidate";
var LANES2 = Object.freeze({
  "public-synthetic": ["bistro-b-0c4e53521a504f6382b4dd07eb5b5a12", "public-synthetic-v1"],
  "existing-keyring": ["bistro-b-8c541600447a4167b70f5149fe6548de", "netlify-6ad1bda7446a63df744c9a30-frozen"]
});
var CONTEXT = [
  "siteID",
  "deploymentID",
  "sourceKind",
  "operationID",
  "sourceGeneration",
  "destinationWorker",
  "recipientKeyFingerprint",
  "nonce",
  "issuedAtMs",
  "expiresAtMs",
  "challenge"
];
var enc2 = new TextEncoder();
var reject = () => {
  throw new Error("CAPSULE_REJECTED");
};
var need = (value) => {
  if (!value) reject();
};
function size(text2) {
  need(typeof text2 === "string" && text2.length <= MAX && enc2.encode(text2).length <= MAX);
  for (let i = 0; i < text2.length; i++) {
    const c = text2.charCodeAt(i);
    if (c >= 55296 && c <= 56319) {
      const next = text2.charCodeAt(++i);
      need(next >= 56320 && next <= 57343);
    } else need(c < 56320 || c > 57343);
  }
  return text2;
}
function exact(value, names) {
  need(value !== null && typeof value === "object" && !Array.isArray(value));
  need(Object.keys(value).sort().join("\0") === [...names].sort().join("\0"));
}
function parse(text2) {
  size(text2);
  let i = 0;
  const ws = () => {
    while (/[\x20\t\r\n]/.test(text2[i] ?? "") && i < text2.length) i++;
  };
  function string() {
    need(text2[i] === '"');
    const start = i++;
    while (i < text2.length) {
      const c = text2[i++];
      if (c === '"') return size(JSON.parse(text2.slice(start, i)));
      if (c === "\\") i++;
    }
    reject();
  }
  function value(depth) {
    need(depth <= 8);
    ws();
    if (text2[i] === '"') return string();
    if (text2[i] === "{") {
      i++;
      ws();
      const obj = /* @__PURE__ */ Object.create(null);
      if (text2[i] === "}") {
        i++;
        return obj;
      }
      while (true) {
        ws();
        const key = string();
        need(!Object.hasOwn(obj, key));
        ws();
        need(text2[i++] === ":");
        obj[key] = value(depth + 1);
        ws();
        const c = text2[i++];
        if (c === "}") return obj;
        need(c === ",");
      }
    }
    if (text2[i] === "[") {
      i++;
      ws();
      const arr = [];
      if (text2[i] === "]") {
        i++;
        return arr;
      }
      while (true) {
        arr.push(value(depth + 1));
        ws();
        const c = text2[i++];
        if (c === "]") return arr;
        need(c === ",");
      }
    }
    const m = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text2.slice(i));
    need(m);
    i += m[0].length;
    return JSON.parse(m[0]);
  }
  const result = value(0);
  ws();
  need(i === text2.length);
  return result;
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
function b64(bytes) {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function unb64(text2, length) {
  need(typeof text2 === "string" && text2.length <= MAX && /^[A-Za-z0-9_-]+$/.test(text2));
  const s = atob(text2.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - text2.length % 4) % 4));
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  need(b64(bytes) === text2 && (length === void 0 || bytes.length === length));
  return bytes;
}
function settings(options = {}) {
  need(options && typeof options === "object");
  need(Object.keys(options).every((k) => ["crypto"].includes(k)));
  const crypto = options.crypto ?? globalThis.crypto;
  const now = Date.now();
  need(crypto?.subtle && typeof crypto.getRandomValues === "function" && Number.isSafeInteger(now) && now >= 0);
  return { crypto, now };
}
function contextShape(input) {
  const c = parse(size(canonical(input)));
  exact(c, CONTEXT);
  need(c.siteID === SITE && c.destinationWorker === DEST);
  need(typeof c.deploymentID === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(c.deploymentID));
  need(Object.hasOwn(LANES2, c.sourceKind));
  need(c.operationID === LANES2[c.sourceKind][0] && c.sourceGeneration === LANES2[c.sourceKind][1]);
  for (const k of ["recipientKeyFingerprint", "nonce", "challenge"]) need(typeof c[k] === "string" && /^[a-f0-9]{64}$/.test(c[k]));
  need(Number.isSafeInteger(c.issuedAtMs) && c.issuedAtMs >= 0 && Number.isSafeInteger(c.expiresAtMs));
  need(c.expiresAtMs > c.issuedAtMs && c.expiresAtMs - c.issuedAtMs <= TTL2);
  return c;
}
function keyring(raw, activeKeyID) {
  const keys = parse(raw);
  need(keys !== null && typeof keys === "object" && !Array.isArray(keys));
  const ids = Object.keys(keys);
  need(ids.length > 0 && typeof activeKeyID === "string" && Object.hasOwn(keys, activeKeyID));
  for (const id of ids) {
    need(id.length > 0 && id.length <= 128 && typeof keys[id] === "string" && keys[id].length > 0);
  }
  return ids;
}
async function fingerprint(crypto, raw) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)), (x) => x.toString(16).padStart(2, "0")).join("");
}
async function publicKey(crypto, encoded) {
  const raw = unb64(encoded, 65);
  need(raw[0] === 4);
  return { raw, key: await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []) };
}
async function aesKey(crypto, privateKey, peer, salt, context) {
  need(privateKey?.type === "private" && privateKey.algorithm?.name === "ECDH" && privateKey.algorithm.namedCurve === "P-256");
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256));
  try {
    const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: enc2.encode(VERSION + "\0" + canonical(context))
      },
      hkdf,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    shared.fill(0);
  }
}
async function guarded(fn) {
  try {
    return await fn();
  } catch {
    reject();
  }
}
function live(context, now) {
  need(now >= context.issuedAtMs && now < context.expiresAtMs);
}
async function operatorPublic(crypto, encoded) {
  const raw = unb64(encoded, 65);
  need(raw[0] === 4);
  const key = await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return { key, fingerprint: await fingerprint(crypto, raw) };
}
async function sealKeyring(input, options) {
  return guarded(async () => {
    exact(input, ["keyringJSON", "activeKeyID", "context", "recipientPublicKey", "operatorPublicKey"]);
    const { keyringJSON, activeKeyID, context, recipientPublicKey, operatorPublicKey } = input;
    const { crypto, now } = settings(options);
    const c = contextShape(context);
    live(c, now);
    need(now < c.issuedAtMs + SOURCE_START_WINDOW2);
    keyring(keyringJSON, activeKeyID);
    const recipient = await publicKey(crypto, recipientPublicKey);
    need(await fingerprint(crypto, recipient.raw) === c.recipientKeyFingerprint);
    const operator = await operatorPublic(crypto, operatorPublicKey);
    const header = { version: VERSION, context: c, operatorKeyFingerprint: operator.fingerprint };
    const payload = enc2.encode(size(canonical({ kind: "keyring", keyringJSON, activeKeyID })));
    try {
      const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      const salt = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await aesKey(crypto, ephemeral.privateKey, recipient.key, salt, header);
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc2.encode(canonical(header)), tagLength: 128 }, key, payload));
      return size(canonical({ ...header, ephemeralPublicKey: b64(new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey))), salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) }));
    } finally {
      payload.fill(0);
    }
  });
}

// outputs/keyring-b-encrypted-relay-20261019/source/source.mjs
var FUNCTION_NAME = "bistro-keyring-transfer";
var SITE_ID = "65a8739e-607f-4a2a-a0f0-618731a921d3";
var CF_ACCOUNT_ID = "1af5e701fec4bbef3fd3b81379e6cc73";
var WORKER_NAME = "bistro-independent-outbox-candidate";
var DESTINATION_WORKER = `${CF_ACCOUNT_ID}/${WORKER_NAME}`;
var DESTINATION_SECRET_NAME = "OUTBOX_TOKEN_KEYS_JSON";
var SOURCE_POLICY_KEY = "source-policy-v2/active";
var SOURCE_POLICY_DOMAIN = "bistro-parent-source-policy-v2";
var PUBLIC_PROOF_GATE_DOMAIN = "bistro-parent-public-cf-proof-gate-v2";
var PUBLIC_PROOF_GATE_KEY = "proof-gate-v2/bistro-b-8c541600447a4167b70f5149fe6548de";
var STORE_NAME = "bistro-keyring-bootstrap-v1";
var MAX_TRANSFER_TTL_MS = 27e5;
var SOURCE_READ_WINDOW_MS = 9e5;
var MAX_STORED_RECORD_BYTES = 6e4;
var FIXED_LANES = Object.freeze({
  "public-synthetic": Object.freeze({
    operationID: "bistro-b-0c4e53521a504f6382b4dd07eb5b5a12",
    sourceGeneration: "public-synthetic-v1"
  }),
  "existing-keyring": Object.freeze({
    operationID: "bistro-b-8c541600447a4167b70f5149fe6548de",
    sourceGeneration: "netlify-6ad1bda7446a63df744c9a30-frozen"
  })
});
var SOURCE_ENV_NAMES = Object.freeze([
  "RESERVATION_TOKEN_KEYS_JSON",
  "RESERVATION_TOKEN_ACTIVE_KEY_ID",
  "RESERVATION_TOKEN_SECRET"
]);
var POLICY_CLAIMS = Object.freeze([
  "schemaVersion",
  "siteID",
  "functionName",
  "deploymentID",
  "sourceArtifactSHA256",
  "sourcePolicyFamilySHA256",
  "sourceMetadataVersion",
  "sourceKind",
  "operationID",
  "sourceGeneration",
  "notBeforeMs",
  "sourceReadStartDeadlineMs",
  "sourceReadWindowMs",
  "transferTTLms",
  "rotationFrozen",
  "baselinePresent",
  "recipientKeyFingerprint",
  "operatorKeyFingerprint",
  "blobsUncachedOrigin",
  "sourceEnvNames",
  "destinationWorker",
  "destinationSecretName"
]);
var GATE_CLAIMS = Object.freeze([
  "schemaVersion",
  "siteID",
  "functionName",
  "deploymentID",
  "sourceArtifactSHA256",
  "sourcePolicyFamilySHA256",
  "sourceMetadataVersion",
  "recipientKeyFingerprint",
  "publicOperationID",
  "publicSourceGeneration",
  "publicCapsuleSHA256",
  "publicObjectVersion",
  "workerAccountID",
  "workerName",
  "workerVersionID",
  "proofEventID",
  "allIDsVerified",
  "keyIDCount",
  "verifiedAtMs",
  "realNotBeforeMs",
  "realSourceReadStartDeadlineMs"
]);
var CAPTURE_RECORD_KEYS = Object.freeze([
  "schemaVersion",
  "operationID",
  "sourceGeneration",
  "sourceKind",
  "siteID",
  "deploymentID",
  "functionName",
  "sourceArtifactSHA256",
  "sourcePolicyFamilySHA256",
  "sourcePolicySHA256",
  "sourceMetadataVersion",
  "recipientKeyFingerprint",
  "operatorKeyFingerprint",
  "context",
  "capsuleSHA256",
  "envelope"
]);
var PUBLIC_SYNTHETIC_KEYRING = Object.freeze({
  synthetic_v1: "PUBLIC_SYNTHETIC_BISTRO_KEY_MATERIAL_ONLY_0000000000000001",
  synthetic_v2: "PUBLIC_SYNTHETIC_BISTRO_KEY_MATERIAL_ONLY_0000000000000002"
});
var Stop = class extends Error {
  constructor(code) {
    super(code);
    this.name = "SourceStop";
    this.code = code;
  }
};
function need2(value, code = "SOURCE_REJECTED") {
  if (!value) throw new Stop(code);
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys2(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function canonicalJSON(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    need2(Number.isSafeInteger(value), "SIGNED_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  need2(isPlainObject(value), "SIGNED_JSON_SHAPE");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}
function decodeBase64Url(value, expectedLength) {
  need2(typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value), "SIGNED_KEY_ENCODING");
  const bytes = Buffer.from(value, "base64url");
  need2(bytes.toString("base64url") === value && (expectedLength === void 0 || bytes.length === expectedLength), "SIGNED_KEY_ENCODING");
  return new Uint8Array(bytes);
}
function sha256Hex(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function objectVersionFromETag(opaqueETag) {
  need2(typeof opaqueETag === "string", "BLOBS_ETAG_REQUIRED");
  const bytes = Buffer.from(opaqueETag, "utf8");
  need2(bytes.length > 0 && bytes.length <= 192 && bytes.toString("utf8") === opaqueETag && !/[\u0000-\u001f\u007f]/.test(opaqueETag), "BLOBS_ETAG_INVALID");
  const version = bytes.toString("base64url");
  need2(/^[A-Za-z0-9_-]{1,256}$/.test(version), "BLOBS_ETAG_INVALID");
  return version;
}
async function publicKeyInfo(encoded) {
  const raw = decodeBase64Url(encoded, 65);
  need2(raw[0] === 4, "PUBLIC_KEY_CURVE");
  const key = await webcrypto.subtle.importKey(
    "raw",
    raw,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  return { key, fingerprint: sha256Hex(raw) };
}
async function verifySignedEnvelope(serialized, domain, encodedPublicKey) {
  need2(
    typeof serialized === "string" && Buffer.byteLength(serialized, "utf8") <= 16384,
    "SIGNED_ENVELOPE_SIZE"
  );
  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    throw new Stop("SIGNED_ENVELOPE_JSON");
  }
  need2(canonicalJSON(envelope) === serialized, "SIGNED_ENVELOPE_CANONICAL");
  need2(
    exactKeys2(envelope, ["domain", "claims", "signature"]) && envelope.domain === domain,
    "SIGNED_ENVELOPE_SHAPE"
  );
  const signature = decodeBase64Url(envelope.signature, 64);
  const keyInfo = await publicKeyInfo(encodedPublicKey);
  const signedBytes = new TextEncoder().encode(canonicalJSON({ domain, claims: envelope.claims }));
  need2(await webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    keyInfo.key,
    signature,
    signedBytes
  ), "SIGNED_ENVELOPE_SIGNATURE");
  return { claims: envelope.claims, operatorKeyFingerprint: keyInfo.fingerprint };
}
function hashLike(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function text(value, max = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function validOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}
async function verifyPolicy(signedEnvelope, pins, platform, now) {
  const verified = await verifySignedEnvelope(signedEnvelope, SOURCE_POLICY_DOMAIN, pins.operatorPublicKey);
  const claims = verified.claims;
  need2(exactKeys2(claims, POLICY_CLAIMS) && claims.schemaVersion === 2, "SOURCE_POLICY_SHAPE");
  need2(claims.siteID === SITE_ID && claims.functionName === FUNCTION_NAME && claims.deploymentID === platform.deploy.id && claims.deploymentID === pins.deploymentID && platform.site.id === SITE_ID && platform.deploy.context === "production" && platform.deploy.published === true, "SOURCE_DEPLOYMENT_MISMATCH");
  need2(claims.sourceArtifactSHA256 === pins.sourceArtifactSHA256 && claims.sourcePolicyFamilySHA256 === pins.sourcePolicyFamilySHA256 && claims.sourceMetadataVersion === pins.sourceMetadataVersion, "SOURCE_ARTIFACT_MISMATCH");
  need2(claims.rotationFrozen === true && claims.baselinePresent === true, "SOURCE_FREEZE_REQUIRED");
  need2(claims.destinationWorker === DESTINATION_WORKER && claims.destinationSecretName === DESTINATION_SECRET_NAME, "SOURCE_DESTINATION_MISMATCH");
  need2(
    claims.blobsUncachedOrigin === pins.edgeUncachedOrigin && validOrigin(claims.blobsUncachedOrigin),
    "SOURCE_BLOBS_ORIGIN_MISMATCH"
  );
  need2(claims.operatorKeyFingerprint === verified.operatorKeyFingerprint && claims.operatorKeyFingerprint === pins.operatorKeyFingerprint && claims.recipientKeyFingerprint === pins.recipientKeyFingerprint, "SOURCE_PUBLIC_KEY_MISMATCH");
  need2(claims.sourceEnvNames === SOURCE_ENV_NAMES || Array.isArray(claims.sourceEnvNames) && claims.sourceEnvNames.length === SOURCE_ENV_NAMES.length && claims.sourceEnvNames.every((v, i) => v === SOURCE_ENV_NAMES[i]), "SOURCE_ENV_ALLOWLIST");
  const lane = FIXED_LANES[claims.sourceKind];
  need2(lane && claims.operationID === lane.operationID && claims.sourceGeneration === lane.sourceGeneration, "SOURCE_LANE_MISMATCH");
  need2(Number.isSafeInteger(claims.notBeforeMs) && Number.isSafeInteger(claims.sourceReadStartDeadlineMs), "SOURCE_WINDOW_FIELDS");
  need2(claims.sourceReadWindowMs === SOURCE_READ_WINDOW_MS && claims.transferTTLms === MAX_TRANSFER_TTL_MS, "SOURCE_WINDOW_CONFIG");
  need2(
    claims.notBeforeMs < claims.sourceReadStartDeadlineMs && claims.sourceReadStartDeadlineMs <= claims.notBeforeMs + SOURCE_READ_WINDOW_MS,
    "SOURCE_WINDOW_BOUNDS"
  );
  need2(now >= claims.notBeforeMs, "SOURCE_NOT_BEFORE");
  need2(now < claims.sourceReadStartDeadlineMs, "SOURCE_READ_START_EXPIRED");
  return {
    claims,
    policySHA256: sha256Hex(signedEnvelope),
    operatorKeyFingerprint: pins.operatorKeyFingerprint,
    recipientKeyFingerprint: pins.recipientKeyFingerprint
  };
}
async function verifyPublicProofGate(signedEnvelope, policy, pins, store, now) {
  const verified = await verifySignedEnvelope(
    signedEnvelope,
    PUBLIC_PROOF_GATE_DOMAIN,
    pins.operatorPublicKey
  );
  const gate = verified.claims;
  need2(exactKeys2(gate, GATE_CLAIMS) && gate.schemaVersion === 2, "PUBLIC_PROOF_GATE_SHAPE");
  need2(gate.siteID === SITE_ID && gate.functionName === FUNCTION_NAME && gate.deploymentID === policy.deploymentID && gate.sourceArtifactSHA256 === policy.sourceArtifactSHA256 && gate.sourcePolicyFamilySHA256 === policy.sourcePolicyFamilySHA256 && gate.sourceMetadataVersion === policy.sourceMetadataVersion && gate.recipientKeyFingerprint === policy.recipientKeyFingerprint, "PUBLIC_PROOF_BINDING");
  need2(gate.publicOperationID === FIXED_LANES["public-synthetic"].operationID && gate.publicSourceGeneration === FIXED_LANES["public-synthetic"].sourceGeneration && gate.workerAccountID === CF_ACCOUNT_ID && gate.workerName === WORKER_NAME && gate.allIDsVerified === true && Number.isSafeInteger(gate.keyIDCount) && gate.keyIDCount > 0 && text(gate.workerVersionID) && text(gate.proofEventID), "PUBLIC_PROOF_RESULT");
  need2(
    Number.isSafeInteger(gate.verifiedAtMs) && Number.isSafeInteger(gate.realNotBeforeMs) && Number.isSafeInteger(gate.realSourceReadStartDeadlineMs) && gate.realNotBeforeMs >= gate.verifiedAtMs && gate.realNotBeforeMs < gate.realSourceReadStartDeadlineMs && gate.realSourceReadStartDeadlineMs <= gate.realNotBeforeMs + SOURCE_READ_WINDOW_MS && now >= gate.realNotBeforeMs && now < gate.realSourceReadStartDeadlineMs,
    "PUBLIC_PROOF_READ_WINDOW"
  );
  const publicObject = await store.read(`capsule/${gate.publicOperationID}`);
  need2(publicObject && objectVersionFromETag(publicObject.etag) === gate.publicObjectVersion && validateCaptureRecord(publicObject.record, {
    operationID: gate.publicOperationID,
    sourceGeneration: gate.publicSourceGeneration,
    sourceKind: "public-synthetic",
    deploymentID: gate.deploymentID,
    sourceArtifactSHA256: gate.sourceArtifactSHA256,
    sourcePolicyFamilySHA256: gate.sourcePolicyFamilySHA256,
    sourceMetadataVersion: gate.sourceMetadataVersion,
    recipientKeyFingerprint: gate.recipientKeyFingerprint,
    capsuleSHA256: gate.publicCapsuleSHA256
  }), "PUBLIC_CAPSULE_BINDING");
  return gate;
}
function validateUnsignedCapsule(serialized, context, operatorFingerprint) {
  need2(
    typeof serialized === "string" && Buffer.byteLength(serialized, "utf8") <= 65536,
    "CAPSULE_SIZE"
  );
  let envelope;
  try {
    envelope = JSON.parse(serialized);
  } catch {
    throw new Stop("CAPSULE_JSON");
  }
  need2(canonicalJSON(envelope) === serialized && exactKeys2(envelope, [
    "version",
    "context",
    "operatorKeyFingerprint",
    "ephemeralPublicKey",
    "salt",
    "iv",
    "ciphertext"
  ]), "CAPSULE_UNSIGNED_V2_REQUIRED");
  need2(envelope.version === "bistro-keyring-capsule-v2" && envelope.operatorKeyFingerprint === operatorFingerprint && canonicalJSON(envelope.context) === canonicalJSON(context), "CAPSULE_CONTEXT_MISMATCH");
  return true;
}
function validateCaptureRecord(record, expected = {}) {
  if (!exactKeys2(record, CAPTURE_RECORD_KEYS) || record.schemaVersion !== 2) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) return false;
  }
  if (!hashLike(record.capsuleSHA256) || !hashLike(record.sourceArtifactSHA256) || !hashLike(record.sourcePolicyFamilySHA256) || !hashLike(record.sourcePolicySHA256) || !hashLike(record.recipientKeyFingerprint) || !hashLike(record.operatorKeyFingerprint) || sha256Hex(record.envelope) !== record.capsuleSHA256) return false;
  if (!isPlainObject(record.context) || record.context.siteID !== record.siteID || record.context.deploymentID !== record.deploymentID || record.context.sourceKind !== record.sourceKind || record.context.operationID !== record.operationID || record.context.sourceGeneration !== record.sourceGeneration || record.context.recipientKeyFingerprint !== record.recipientKeyFingerprint) return false;
  try {
    validateUnsignedCapsule(record.envelope, record.context, record.operatorKeyFingerprint);
  } catch {
    return false;
  }
  return true;
}
function resolveReservationMaterial(readEnvironment) {
  need2(typeof readEnvironment === "function", "SOURCE_ENV_READER");
  const raw = readEnvironment("RESERVATION_TOKEN_KEYS_JSON");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length > 0) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Stop("SOURCE_KEYRING_JSON_INVALID");
    }
    let entries;
    try {
      entries = Object.entries(parsed);
    } catch {
      throw new Stop("SOURCE_KEYRING_JSON_INVALID");
    }
    const usable = /* @__PURE__ */ Object.create(null);
    for (const [id, value] of entries) {
      if (typeof value === "string" && value.trim().length >= 32) usable[id] = value;
    }
    const activeValue = readEnvironment("RESERVATION_TOKEN_ACTIVE_KEY_ID");
    const activeKeyID = typeof activeValue === "string" ? activeValue.trim() || "v1" : "v1";
    need2(Object.hasOwn(usable, activeKeyID), "SOURCE_ACTIVE_KEY_INVALID");
    return { keyringJSON: raw, activeKeyID, sourceFormat: "json-keyring" };
  }
  const legacyValue = readEnvironment("RESERVATION_TOKEN_SECRET");
  const legacySecret = typeof legacyValue === "string" ? legacyValue.trim() : "";
  need2(legacySecret.length >= 32, "SOURCE_LEGACY_KEY_INVALID");
  return {
    keyringJSON: JSON.stringify({ v1: legacySecret }),
    activeKeyID: "v1",
    sourceFormat: "legacy-v1"
  };
}
function laneManifest(policy, context) {
  return {
    siteID: SITE_ID,
    sourceGeneration: policy.sourceGeneration,
    operationID: policy.operationID,
    destination: {
      accountID: CF_ACCOUNT_ID,
      workerName: WORKER_NAME,
      secretName: DESTINATION_SECRET_NAME
    },
    deploymentID: policy.deploymentID,
    functionName: FUNCTION_NAME,
    sourceMetadataVersion: policy.sourceMetadataVersion,
    notBeforeMs: policy.notBeforeMs,
    startDeadlineMs: policy.sourceReadStartDeadlineMs,
    deadlineMs: context.expiresAtMs,
    cleanupReserveMs: 5e3
  };
}
function makeContext(policy, recipientKeyFingerprint, issuedAtMs) {
  return {
    siteID: SITE_ID,
    deploymentID: policy.deploymentID,
    sourceKind: policy.sourceKind,
    operationID: policy.operationID,
    sourceGeneration: policy.sourceGeneration,
    destinationWorker: DESTINATION_WORKER,
    recipientKeyFingerprint,
    nonce: randomBytes(32).toString("hex"),
    issuedAtMs,
    expiresAtMs: issuedAtMs + MAX_TRANSFER_TTL_MS,
    challenge: randomBytes(32).toString("hex")
  };
}
function safeCaptureLog(record, objectVersion) {
  return {
    event: "CAPTURE_COMMITTED",
    operationID: record.operationID,
    sourceGeneration: record.sourceGeneration,
    deploymentID: record.deploymentID,
    capsuleSHA256: record.capsuleSHA256,
    objectIdentity: {
      storeName: STORE_NAME,
      objectKey: `capsule/${record.operationID}`,
      objectVersion
    }
  };
}
function createScheduledSource({
  createStore,
  readEnvironment,
  getPlatformContext,
  isScheduledInvocation,
  operatorPublicKey,
  recipientPublicKey,
  edgeUncachedOrigin,
  sourceArtifactSHA256,
  sourcePolicyFamilySHA256,
  sourceMetadataVersion,
  log = (message) => console.log(message),
  onStopCode = () => {
  },
  now = Date.now,
  makeRandomNonce = () => randomBytes(32).toString("hex")
} = {}) {
  need2(
    typeof createStore === "function" && typeof readEnvironment === "function" && typeof getPlatformContext === "function" && typeof isScheduledInvocation === "function",
    "SOURCE_DEPENDENCY_REQUIRED"
  );
  need2(typeof log === "function" && typeof onStopCode === "function" && typeof now === "function" && typeof makeRandomNonce === "function", "SOURCE_DEPENDENCY_INVALID");
  need2(typeof operatorPublicKey === "string" && typeof recipientPublicKey === "string" && hashLike(sourceArtifactSHA256) && hashLike(sourcePolicyFamilySHA256) && text(sourceMetadataVersion) && validOrigin(edgeUncachedOrigin), "SOURCE_PUBLIC_CONFIG_REQUIRED");
  return async function runScheduledSource() {
    try {
      const platform = await getPlatformContext();
      need2(platform && await isScheduledInvocation(platform), "SCHEDULED_INVOCATION_REQUIRED");
      need2(platform.site?.id === SITE_ID && platform.deploy?.context === "production" && platform.deploy?.published === true && text(platform.deploy?.id), "NETLIFY_CONTEXT_REJECTED");
      const operatorInfo = await publicKeyInfo(operatorPublicKey);
      const recipientRaw = decodeBase64Url(recipientPublicKey, 65);
      need2(recipientRaw[0] === 4, "RECIPIENT_PUBLIC_KEY");
      const recipientKeyFingerprint = sha256Hex(recipientRaw);
      const controlDeadline = now() + 5e3;
      const controlStore = createStore(controlDeadline);
      const policyRecord = await controlStore.read(SOURCE_POLICY_KEY);
      need2(policyRecord && isPlainObject(policyRecord.record) && exactKeys2(policyRecord.record, ["signedEnvelope"]) && typeof policyRecord.record.signedEnvelope === "string", "SOURCE_POLICY_ABSENT");
      const verifiedPolicy = await verifyPolicy(policyRecord.record.signedEnvelope, {
        operatorPublicKey,
        operatorKeyFingerprint: operatorInfo.fingerprint,
        recipientKeyFingerprint,
        edgeUncachedOrigin,
        deploymentID: platform.deploy.id,
        sourceArtifactSHA256,
        sourcePolicyFamilySHA256,
        sourceMetadataVersion
      }, platform, now());
      const policy = verifiedPolicy.claims;
      need2(policy.siteID === SITE_ID && policy.functionName === FUNCTION_NAME && policy.deploymentID === platform.deploy.id && policy.sourceArtifactSHA256 === sourceArtifactSHA256, "SOURCE_DEPLOYMENT_MISMATCH");
      need2(hashLike(policy.sourcePolicyFamilySHA256) && hashLike(policy.sourceArtifactSHA256) && text(policy.sourceMetadataVersion) && policy.rotationFrozen === true && policy.baselinePresent === true, "SOURCE_FREEZE_REQUIRED");
      need2(policy.destinationWorker === DESTINATION_WORKER && policy.destinationSecretName === DESTINATION_SECRET_NAME && policy.blobsUncachedOrigin === edgeUncachedOrigin, "SOURCE_TARGET_MISMATCH");
      need2(policy.sourceEnvNames.length === SOURCE_ENV_NAMES.length && policy.sourceEnvNames.every((name, i) => name === SOURCE_ENV_NAMES[i]), "SOURCE_ENV_ALLOWLIST");
      const lane = FIXED_LANES[policy.sourceKind];
      need2(lane && policy.operationID === lane.operationID && policy.sourceGeneration === lane.sourceGeneration, "SOURCE_LANE_MISMATCH");
      const current = now();
      need2(
        Number.isSafeInteger(policy.notBeforeMs) && Number.isSafeInteger(policy.sourceReadStartDeadlineMs) && policy.sourceReadWindowMs === SOURCE_READ_WINDOW_MS && policy.transferTTLms === MAX_TRANSFER_TTL_MS && policy.notBeforeMs < policy.sourceReadStartDeadlineMs && policy.sourceReadStartDeadlineMs <= policy.notBeforeMs + SOURCE_READ_WINDOW_MS && current >= policy.notBeforeMs && current < policy.sourceReadStartDeadlineMs,
        "SOURCE_START_WINDOW"
      );
      let gate = null;
      if (policy.sourceKind === "existing-keyring") {
        const gateRecord = await controlStore.read(PUBLIC_PROOF_GATE_KEY);
        need2(gateRecord && isPlainObject(gateRecord.record) && exactKeys2(gateRecord.record, ["signedEnvelope"]) && typeof gateRecord.record.signedEnvelope === "string", "PUBLIC_PROOF_GATE_ABSENT");
        gate = await verifyPublicProofGate(
          gateRecord.record.signedEnvelope,
          policy,
          {
            operatorPublicKey,
            sourceArtifactSHA256
          },
          controlStore,
          current
        );
        need2(
          policy.notBeforeMs >= gate.verifiedAtMs && policy.notBeforeMs === gate.realNotBeforeMs && policy.sourceReadStartDeadlineMs === gate.realSourceReadStartDeadlineMs,
          "PUBLIC_PROOF_WINDOW_BINDING"
        );
      } else {
        const gateRecord = await controlStore.read(PUBLIC_PROOF_GATE_KEY);
        need2(gateRecord === null, "PUBLIC_PROOF_ALREADY_ADVANCED");
      }
      const issuedAtMs = now();
      need2(
        issuedAtMs >= policy.notBeforeMs && issuedAtMs < policy.sourceReadStartDeadlineMs,
        "SOURCE_START_EXPIRED"
      );
      const context = makeContext(policy, verifiedPolicy.recipientKeyFingerprint, issuedAtMs);
      const executionDeadline = Math.min(issuedAtMs + 25e3, context.expiresAtMs);
      const store = createStore(executionDeadline);
      const capsuleKey = `capsule/${policy.operationID}`;
      need2(await store.read(capsuleKey) === null, "CAPSULE_ALREADY_EXISTS");
      const manifest = laneManifest(policy, context);
      const ledger = createOneShotLedger({
        manifest,
        store,
        now,
        randomNonce: makeRandomNonce
      });
      const ledgerContext = {
        siteID: SITE_ID,
        deploymentID: policy.deploymentID,
        sourceGeneration: policy.sourceGeneration,
        operationID: policy.operationID,
        destination: manifest.destination,
        functionName: FUNCTION_NAME,
        sourceMetadataVersion: policy.sourceMetadataVersion,
        baselinePresent: true,
        rotationFrozen: true
      };
      const claim = await ledger.claim(ledgerContext);
      need2(claim?.ok === true && claim.stage === "CLAIMED", "SOURCE_CLAIM_REJECTED");
      need2(now() < policy.sourceReadStartDeadlineMs, "SOURCE_READ_WINDOW_EXPIRED");
      let material;
      try {
        material = policy.sourceKind === "public-synthetic" ? {
          keyringJSON: JSON.stringify(PUBLIC_SYNTHETIC_KEYRING),
          activeKeyID: "synthetic_v1",
          sourceFormat: "public-synthetic"
        } : resolveReservationMaterial(readEnvironment);
        const envelope = await sealKeyring({
          keyringJSON: material.keyringJSON,
          activeKeyID: material.activeKeyID,
          context,
          recipientPublicKey,
          operatorPublicKey
        });
        validateUnsignedCapsule(envelope, context, policy.operatorKeyFingerprint);
        const capsuleSHA256 = sha256Hex(envelope);
        const record = {
          schemaVersion: 2,
          operationID: policy.operationID,
          sourceGeneration: policy.sourceGeneration,
          sourceKind: policy.sourceKind,
          siteID: SITE_ID,
          deploymentID: policy.deploymentID,
          functionName: FUNCTION_NAME,
          sourceArtifactSHA256: policy.sourceArtifactSHA256,
          sourcePolicyFamilySHA256: policy.sourcePolicyFamilySHA256,
          sourcePolicySHA256: verifiedPolicy.policySHA256,
          sourceMetadataVersion: policy.sourceMetadataVersion,
          recipientKeyFingerprint: policy.recipientKeyFingerprint,
          operatorKeyFingerprint: policy.operatorKeyFingerprint,
          context,
          capsuleSHA256,
          envelope
        };
        need2(
          Buffer.byteLength(canonicalJSON(record), "utf8") <= MAX_STORED_RECORD_BYTES,
          "CAPSULE_RECORD_SIZE"
        );
        const created = await store.create(capsuleKey, record);
        need2(created?.modified === true, "CAPSULE_CONDITIONAL_CREATE_FAILED");
        const readback = await store.read(capsuleKey);
        need2(readback && typeof readback.etag === "string" && canonicalJSON(readback.record) === canonicalJSON(record) && validateCaptureRecord(readback.record, {
          operationID: policy.operationID,
          sourceGeneration: policy.sourceGeneration,
          sourceKind: policy.sourceKind,
          deploymentID: policy.deploymentID,
          sourceArtifactSHA256: policy.sourceArtifactSHA256,
          sourcePolicyFamilySHA256: policy.sourcePolicyFamilySHA256,
          sourceMetadataVersion: policy.sourceMetadataVersion,
          recipientKeyFingerprint: policy.recipientKeyFingerprint,
          capsuleSHA256
        }), "CAPSULE_READBACK_FAILED");
        const committed = safeCaptureLog(record, objectVersionFromETag(readback.etag));
        log(JSON.stringify(committed));
        return committed;
      } finally {
        material = void 0;
      }
    } catch (error) {
      try {
        onStopCode(error instanceof Stop ? error.code : "UNEXPECTED_STOP");
      } catch {
      }
      return { status: "STOPPED_NO_RAW_ERROR" };
    }
  };
}
var _sourcePolicyInternalsForTests = Object.freeze({
  canonicalJSON,
  verifySignedEnvelope,
  SOURCE_POLICY_DOMAIN,
  PUBLIC_PROOF_GATE_DOMAIN
});

// outputs/keyring-b-implementation/core/blobs-origin.mjs
var BLOBS_ORIGIN = "https://edge-uncached.netlifyblobs.com";
function isProductionBlobsOrigin(value) {
  return value === BLOBS_ORIGIN;
}

// outputs/keyring-b-implementation/core/transport.mjs
var Stop2 = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
};
var requireValue = (v, code) => {
  if (!v) throw new Stop2(code);
};
async function readBounded(response, limit = 65536) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let n = 0;
  try {
    for (; ; ) {
      const r = await reader.read();
      if (r.done) break;
      n += r.value.length;
      requireValue(n <= limit, "RESPONSE_LIMIT");
      chunks.push(r.value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
    }
    throw new Stop2("RESPONSE_READ_FAILED");
  }
  const all = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

// outputs/keyring-b-implementation/core/blobs-adapter.mjs
function createBlobsAdapter({ getStore: getStore2, fetchImpl, siteID, storeName, allowedOrigins, testOnlyOrigins = [], now = Date.now, deadlineMs }) {
  requireValue(siteID === "65a8739e-607f-4a2a-a0f0-618731a921d3" && storeName === "bistro-keyring-bootstrap-v1", "BLOBS_TARGET_REJECTED");
  const testInjection = fetchImpl !== globalThis.fetch && typeof fetchImpl === "function";
  requireValue(Array.isArray(testOnlyOrigins) && (!testOnlyOrigins.length || testInjection), "BLOBS_TEST_INJECTION_REJECTED");
  requireValue(Array.isArray(allowedOrigins) && allowedOrigins.length > 0 && allowedOrigins.every((s) => {
    try {
      const u = new URL(s);
      return u.origin === s && u.protocol === "https:" && !u.username && !u.password && (isProductionBlobsOrigin(s) || s === "https://api.netlify.com" || testOnlyOrigins.includes(s));
    } catch {
      return false;
    }
  }), "BLOBS_ORIGIN_REJECTED");
  let active = false, outcomeError = false, attempts = 0;
  const seen = /* @__PURE__ */ new WeakSet();
  async function guardedFetch(url, options) {
    try {
      requireValue(active && attempts++ === 0 && options && typeof options === "object" && !seen.has(options), "BLOBS_RETRY_REJECTED");
      seen.add(options);
      const u = new URL(url);
      requireValue(allowedOrigins.includes(u.origin) && !u.username && !u.password && decodeURIComponent(u.pathname).includes("/" + siteID + "/"), "BLOBS_ORIGIN_REJECTED");
      requireValue(["get", "put"].includes(String(options.method).toLowerCase()), "BLOBS_METHOD_REJECTED");
      const left = deadlineMs - now();
      requireValue(left > 500, "DEADLINE");
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Math.min(left, 4e3));
      try {
        const r = await fetchImpl(url, { ...options, redirect: "error", signal: ctl.signal });
        const allowed = String(options.method).toLowerCase() === "put" ? [200, 412] : [200, 404];
        requireValue(allowed.includes(r.status), "BLOBS_HTTP_UNKNOWN");
        const raw = await readBounded(r, 65536);
        return new Response(raw, { status: r.status, headers: r.headers });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      outcomeError = true;
      return new Response("", { status: 409 });
    }
  }
  const store = getStore2({ name: storeName, siteID, consistency: "strong", fetch: guardedFetch });
  async function operation(fn) {
    requireValue(!active, "BLOBS_CONCURRENT_CLIENT_REJECTED");
    active = true;
    outcomeError = false;
    attempts = 0;
    try {
      const value = await fn();
      requireValue(!outcomeError, "BLOBS_OUTCOME_UNKNOWN");
      return value;
    } catch {
      throw new Stop2("BLOBS_OUTCOME_UNKNOWN");
    } finally {
      active = false;
    }
  }
  function validKey(k) {
    requireValue(typeof k === "string" && /^[a-z0-9/_-]{1,180}$/.test(k) && !k.includes(".."), "BLOBS_KEY_REJECTED");
  }
  return Object.freeze({
    read(key) {
      validKey(key);
      return operation(async () => {
        const r = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
        if (r === null) return null;
        requireValue(typeof r.etag === "string" && r.etag.length > 0, "BLOBS_ETAG_REQUIRED");
        return { record: r.data, etag: r.etag };
      });
    },
    create(key, record) {
      validKey(key);
      return operation(async () => {
        const r = await store.setJSON(key, record, { onlyIfNew: true });
        requireValue(typeof r?.modified === "boolean", "BLOBS_RESPONSE_REJECTED");
        return { modified: r.modified };
      });
    },
    cas(key, record, { onlyIfMatch }) {
      validKey(key);
      requireValue(typeof onlyIfMatch === "string" && onlyIfMatch.length > 0, "BLOBS_ETAG_REQUIRED");
      return operation(async () => {
        const r = await store.setJSON(key, record, { onlyIfMatch });
        requireValue(typeof r?.modified === "boolean", "BLOBS_RESPONSE_REJECTED");
        return { modified: r.modified };
      });
    }
  });
}

// outputs/keyring-b-encrypted-relay-20261019/source/store-adapter.mjs
var NETLIFY_SITE_ID = "65a8739e-607f-4a2a-a0f0-618731a921d3";
var BOOTSTRAP_STORE = "bistro-keyring-bootstrap-v1";
var EDGE_UNCACHED_ORIGIN = BLOBS_ORIGIN;
var NETLIFY_API_ORIGIN = "https://api.netlify.com";
function requireValue2(value, code) {
  if (!value) throw new Error(code);
}
function exactOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}
function createSourceStoreFactory({
  getStore: getStore2,
  edgeUncachedOrigin,
  fetchImpl = globalThis.fetch,
  testOnlyOrigins = [],
  now = Date.now
} = {}) {
  requireValue2(typeof getStore2 === "function", "BLOBS_GET_STORE_REQUIRED");
  requireValue2(exactOrigin(edgeUncachedOrigin), "BLOBS_EDGE_ORIGIN_REQUIRED");
  requireValue2(typeof fetchImpl === "function", "BLOBS_FETCH_REQUIRED");
  requireValue2(Array.isArray(testOnlyOrigins), "BLOBS_TEST_ORIGINS_INVALID");
  requireValue2(
    testOnlyOrigins.length === 0 || fetchImpl !== globalThis.fetch,
    "BLOBS_TEST_INJECTION_REQUIRED"
  );
  requireValue2(
    edgeUncachedOrigin === EDGE_UNCACHED_ORIGIN || testOnlyOrigins.includes(edgeUncachedOrigin) && fetchImpl !== globalThis.fetch,
    "BLOBS_EDGE_ORIGIN_NOT_PINNED"
  );
  for (const origin of testOnlyOrigins) {
    requireValue2(exactOrigin(origin), "BLOBS_TEST_ORIGIN_INVALID");
  }
  const allowedOrigins = [NETLIFY_API_ORIGIN, edgeUncachedOrigin];
  return function createSourceStore(deadlineMs) {
    requireValue2(
      Number.isSafeInteger(deadlineMs) && deadlineMs > now(),
      "BLOBS_DEADLINE_INVALID"
    );
    return createBlobsAdapter({
      getStore: getStore2,
      fetchImpl,
      siteID: NETLIFY_SITE_ID,
      storeName: BOOTSTRAP_STORE,
      allowedOrigins,
      testOnlyOrigins,
      now,
      deadlineMs
    });
  };
}

// pins:public-pins
var PUBLIC_PINS = { "operatorPublicKey": "BJgVhOnL1AtH1G0Ts5FhtdClElR4gDviNNNoxLXreCLpZW-yF_0ViUQd1ICmjzW51rhkDRQvDlcXVnjGzZAMLFc", "recipientPublicKey": "BB_INGECIjHYh0YEmiCIoQEd9096v5AldPDT-k04N6nJ8TDtvU6mmX0LRfj4osow7udpyY6L-K2hcd0NuudKJmY", "sourceArtifactSHA256": "2e94b85537bff2e02740114a4bf74b00cd4a6a84cf1bfb00248c34ff725092fe", "sourcePolicyFamilySHA256": "0170f1b5e42869d02e774809bf32d2bfaf5fbe1ef9dd34bcbf100bc121e8b6b5", "sourceMetadataVersion": "bistro-encrypted-source-v2-20261019", "edgeUncachedOrigin": "https://edge-uncached.netlifyblobs.com" };

// outputs/keyring-b-encrypted-relay-20261019/deployment/entry-template.mjs
var config = { schedule: "0 0 1 1 *" };
var SITE2 = "65a8739e-607f-4a2a-a0f0-618731a921d3";
var ACCOUNT = "6a8eabfcb2cd6a6a287993f7";
var safeLog = (record) => console.log(JSON.stringify(record));
async function validateScheduledHost(request, context) {
  if (context?.site?.id !== SITE2) throw Error("HOST_SITE_MISMATCH");
  if (context.account?.id !== ACCOUNT) throw Error("HOST_ACCOUNT_MISMATCH");
  if (context.deploy?.context !== "production" || context.deploy?.published !== true || !/^[a-f0-9]{24}$/.test(context.deploy?.id ?? "")) throw Error("HOST_DEPLOY_MISMATCH");
  if (request.method !== "POST") throw Error("HOST_METHOD_REJECTED");
  const text2 = await request.text();
  if (new TextEncoder().encode(text2).length > 512) return false;
  const body = JSON.parse(text2);
  if (!body || Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).join(",") !== "next_run" || typeof body.next_run !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(body.next_run)) return false;
  const next = Date.parse(body.next_run), now = Date.now();
  return Number.isFinite(next) && next > now && next - now <= 366 * 864e5;
}
var entry_template_default = async (request, context) => {
  let admitted = false, code = "HOST_SCHEDULE_BODY_REJECTED";
  try {
    admitted = await validateScheduledHost(request, context);
  } catch (e) {
    if (["HOST_SITE_MISMATCH", "HOST_ACCOUNT_MISMATCH", "HOST_DEPLOY_MISMATCH", "HOST_METHOD_REJECTED"].includes(e?.message)) code = e.message;
  }
  if (!admitted) {
    safeLog({ stage: "HOST_SCHEDULE_ADMISSION_STOP", code, sourceRead: false, storeIO: false });
    return;
  }
  const factory = createSourceStoreFactory({ getStore, edgeUncachedOrigin: PUBLIC_PINS.edgeUncachedOrigin });
  const createStore = (deadline) => {
    const store = factory(deadline), wrapped = {};
    for (const action of ["read", "create", "cas"]) wrapped[action] = async (key, ...args) => {
      const keyKind = key === "source-policy-v2/active" ? "SOURCE_POLICY" : key.startsWith("proof-gate-v2/") ? "PUBLIC_GATE" : key.startsWith("capsule/") ? "CAPSULE" : "ONE_SHOT_LEDGER";
      safeLog({ stage: "SOURCE_IO_BEGIN", action, keyKind });
      const result = await store[action](key, ...args);
      safeLog({ stage: "SOURCE_IO_ACK", action, keyKind });
      return result;
    };
    return wrapped;
  };
  const run = createScheduledSource({
    ...PUBLIC_PINS,
    createStore,
    readEnvironment: (name) => {
      if (!["RESERVATION_TOKEN_KEYS_JSON", "RESERVATION_TOKEN_ACTIVE_KEY_ID", "RESERVATION_TOKEN_SECRET"].includes(name)) throw Error("SOURCE_ENV_REJECTED");
      safeLog({ stage: "SOURCE_KEY_READ", name });
      return process.env[name];
    },
    getPlatformContext: () => ({ site: { id: context.site.id }, deploy: { id: context.deploy.id, context: context.deploy.context, published: context.deploy.published } }),
    isScheduledInvocation: () => admitted,
    log: (message) => console.log(message),
    onStopCode: (code2) => safeLog({ stage: "SOURCE_STOP", code: /^[A-Z_]{1,80}$/.test(code2) ? code2 : "UNEXPECTED_STOP" })
  });
  await run();
};
export {
  config,
  entry_template_default as default,
  validateScheduledHost
};
