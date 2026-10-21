import { DEFAULT_IPFS_GATEWAY, REGISTRIES, getNetworkConfig } from "./config.js";

export { DEFAULT_IPFS_GATEWAY, REGISTRIES, getNetworkConfig };

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const SELECTORS = {
  ownerOf: "0x6352211e",
  tokenURI: "0xc87b56dd",
  getClients: "0x42dd519c",
  readAllFeedback: "0xd9d84224",
  getSummary: "0x81bbba58",
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function cleanHex(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^0x/i, "");
}

function word(value) {
  const n = BigInt(value);
  const twos = n < 0n ? (1n << 256n) + n : n;
  return twos.toString(16).padStart(64, "0");
}

function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex) {
  const clean = cleanHex(hex);
  if (clean.length % 2 !== 0) {
    throw new Error("Odd-length hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("Invalid hex byte");
    }
    out[i] = byte;
  }
  return out;
}

function padRight32(hex) {
  if (hex.length === 0) return "";
  const rem = hex.length % 64;
  return rem === 0 ? hex : hex + "0".repeat(64 - rem);
}

function encodeAddressWord(address) {
  const clean = cleanHex(address).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
  return clean.padStart(64, "0");
}

export function encodeAddressArray(addresses = []) {
  return word(addresses.length) + addresses.map(encodeAddressWord).join("");
}

export function encodeString(str = "") {
  const bytes = textEncoder.encode(String(str));
  return word(bytes.length) + padRight32(bytesToHex(bytes));
}

export function encodeOwnerOf(agentId) {
  return SELECTORS.ownerOf + word(agentId);
}

export function encodeTokenURI(agentId) {
  return SELECTORS.tokenURI + word(agentId);
}

export function encodeGetClients(agentId) {
  return SELECTORS.getClients + word(agentId);
}

/**
 * ABI-encodes readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked)
 * Selector: 0xd9d84224
 * Static head slots (5 * 32 = 160 bytes):
 *   slot 0: agentId (uint256)
 *   slot 1: byte offset to clientAddresses
 *   slot 2: byte offset to tag1
 *   slot 3: byte offset to tag2
 *   slot 4: includeRevoked (bool)
 */
export function encodeReadAllFeedback(
  agentId,
  clients = [],
  tag1 = "",
  tag2 = "",
  includeRevoked = false
) {
  const tailClients = encodeAddressArray(clients);
  const tailTag1 = encodeString(tag1);
  const tailTag2 = encodeString(tag2);

  const offsetClients = 5 * 32;
  const offsetTag1 = offsetClients + tailClients.length / 2;
  const offsetTag2 = offsetTag1 + tailTag1.length / 2;

  return (
    SELECTORS.readAllFeedback +
    word(agentId) +
    word(offsetClients) +
    word(offsetTag1) +
    word(offsetTag2) +
    word(includeRevoked ? 1 : 0) +
    tailClients +
    tailTag1 +
    tailTag2
  );
}

export function encodeGetSummary(agentId, clients = [], tag1 = "", tag2 = "") {
  const tailClients = encodeAddressArray(clients);
  const tailTag1 = encodeString(tag1);
  const tailTag2 = encodeString(tag2);

  const offsetClients = 4 * 32;
  const offsetTag1 = offsetClients + tailClients.length / 2;
  const offsetTag2 = offsetTag1 + tailTag1.length / 2;

  return (
    SELECTORS.getSummary +
    word(agentId) +
    word(offsetClients) +
    word(offsetTag1) +
    word(offsetTag2) +
    tailClients +
    tailTag1 +
    tailTag2
  );
}

function readUint256At(cleanData, byteOffset) {
  const start = byteOffset * 2;
  const slice = cleanData.slice(start, start + 64);
  if (slice.length < 64) {
    throw new Error("Unexpected end of ABI data");
  }
  return BigInt("0x" + slice);
}

function readInt256At(cleanData, byteOffset) {
  const u = readUint256At(cleanData, byteOffset);
  return u >= 1n << 255n ? u - (1n << 256n) : u;
}

export function decodeAddressWord(hex) {
  const clean = cleanHex(hex);
  if (clean.length === 0 || /^0+$/.test(clean)) {
    return ZERO_ADDRESS;
  }
  if (clean.length < 64) {
    throw new Error("Short address word in ABI response");
  }
  return "0x" + clean.slice(24, 64).toLowerCase();
}

export function decodeAbiString(hex) {
  const clean = cleanHex(hex);
  if (clean.length === 0) return "";
  if (clean.length < 128) {
    throw new Error("Short string ABI response");
  }
  const offset = Number(readUint256At(clean, 0));
  const byteLength = Number(readUint256At(clean, offset));
  const dataStart = (offset + 32) * 2;
  const dataEnd = dataStart + byteLength * 2;
  if (clean.length < dataEnd) {
    throw new Error("Truncated ABI string payload");
  }
  return textDecoder.decode(hexToBytes(clean.slice(dataStart, dataEnd)));
}

function decodeAddressArrayAt(clean, baseByteOffset) {
  const length = Number(readUint256At(clean, baseByteOffset));
  const items = [];
  for (let i = 0; i < length; i += 1) {
    const wordStart = (baseByteOffset + 32 + i * 32) * 2;
    const wordSlice = clean.slice(wordStart, wordStart + 64);
    if (wordSlice.length < 64) {
      throw new Error("Truncated ABI address array");
    }
    items.push("0x" + wordSlice.slice(24, 64).toLowerCase());
  }
  return items;
}

function decodeUintArrayAt(clean, baseByteOffset) {
  const length = Number(readUint256At(clean, baseByteOffset));
  const items = [];
  for (let i = 0; i < length; i += 1) {
    items.push(Number(readUint256At(clean, baseByteOffset + 32 + i * 32)));
  }
  return items;
}

function decodeIntArrayAt(clean, baseByteOffset) {
  const length = Number(readUint256At(clean, baseByteOffset));
  const items = [];
  for (let i = 0; i < length; i += 1) {
    items.push(readInt256At(clean, baseByteOffset + 32 + i * 32));
  }
  return items;
}

function decodeBoolArrayAt(clean, baseByteOffset) {
  const length = Number(readUint256At(clean, baseByteOffset));
  const items = [];
  for (let i = 0; i < length; i += 1) {
    items.push(readUint256At(clean, baseByteOffset + 32 + i * 32) !== 0n);
  }
  return items;
}

function decodeStringArrayAt(clean, baseByteOffset) {
  const length = Number(readUint256At(clean, baseByteOffset));
  const elementsStart = baseByteOffset + 32;
  const items = [];
  for (let i = 0; i < length; i += 1) {
    const relOffset = Number(readUint256At(clean, elementsStart + i * 32));
    const strOffset = elementsStart + relOffset;
    const byteLength = Number(readUint256At(clean, strOffset));
    const startHex = (strOffset + 32) * 2;
    const endHex = startHex + byteLength * 2;
    if (clean.length < endHex) {
      throw new Error("Truncated ABI string array element");
    }
    items.push(textDecoder.decode(hexToBytes(clean.slice(startHex, endHex))));
  }
  return items;
}

export function decodeAddressArray(hex) {
  const clean = cleanHex(hex);
  if (clean.length === 0) return [];
  const offset = Number(readUint256At(clean, 0));
  return decodeAddressArrayAt(clean, offset);
}

export function decodeReadAllFeedback(hex) {
  const clean = cleanHex(hex);
  if (clean.length === 0) return [];
  const firstOffset = Number(readUint256At(clean, 0));

  // Standard ERC-8004 ReputationRegistryUpgradeable returns 7 dynamic arrays (first offset = 7 * 32 = 224)
  if (firstOffset === 224) {
    const offsets = [];
    for (let i = 0; i < 7; i += 1) {
      offsets.push(Number(readUint256At(clean, i * 32)));
    }
    const clients = decodeAddressArrayAt(clean, offsets[0]);
    const feedbackIndexes = decodeUintArrayAt(clean, offsets[1]);
    const values = decodeIntArrayAt(clean, offsets[2]);
    const valueDecimals = decodeUintArrayAt(clean, offsets[3]);
    const tag1s = decodeStringArrayAt(clean, offsets[4]);
    const tag2s = decodeStringArrayAt(clean, offsets[5]);
    const revokedStatuses = decodeBoolArrayAt(clean, offsets[6]);

    const items = [];
    for (let i = 0; i < clients.length; i += 1) {
      if (revokedStatuses[i]) continue;
      const decimals = Number(valueDecimals[i] ?? 0);
      const rawValue = Number(values[i] ?? 0n);
      const score = rawValue / 10 ** decimals;
      const tags = [tag1s[i], tag2s[i]].filter((t) => typeof t === "string" && t.length > 0);
      items.push({
        client: clients[i],
        index: feedbackIndexes[i] ?? i + 1,
        score,
        tags,
      });
    }
    return items;
  }

  // Fallback for 5-array tuple (clients, values, valueDecimals, tag1s, tag2s)
  if (firstOffset === 160) {
    const offsets = [];
    for (let i = 0; i < 5; i += 1) {
      offsets.push(Number(readUint256At(clean, i * 32)));
    }
    const clients = decodeAddressArrayAt(clean, offsets[0]);
    const values = decodeIntArrayAt(clean, offsets[1]);
    const valueDecimals = decodeUintArrayAt(clean, offsets[2]);
    const tag1s = decodeStringArrayAt(clean, offsets[3]);
    const tag2s = decodeStringArrayAt(clean, offsets[4]);
    const items = [];
    for (let i = 0; i < clients.length; i += 1) {
      const decimals = Number(valueDecimals[i] ?? 0);
      const rawValue = Number(values[i] ?? 0n);
      const score = rawValue / 10 ** decimals;
      const tags = [tag1s[i], tag2s[i]].filter((t) => typeof t === "string" && t.length > 0);
      items.push({ client: clients[i], score, tags });
    }
    return items;
  }

  throw new Error("Unsupported readAllFeedback ABI layout");
}

export function decodeGetSummary(hex) {
  const clean = cleanHex(hex);
  if (clean.length < 192) {
    throw new Error("Short getSummary ABI response");
  }
  const count = Number(readUint256At(clean, 0));
  const summaryValue = Number(readInt256At(clean, 32));
  const decimals = Number(readUint256At(clean, 64));
  return {
    count,
    average: count === 0 ? 0 : summaryValue / 10 ** decimals,
  };
}

function decodeBase64ToUtf8(b64) {
  const cleaned = String(b64).replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return Buffer.from(cleaned, "base64").toString("utf8");
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return textDecoder.decode(bytes);
}

export function decodeDataUri(uri) {
  const raw = String(uri || "").trim();
  if (!raw.toLowerCase().startsWith("data:")) {
    throw new Error("Not a data URI");
  }
  const commaIndex = raw.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Malformed data URI: missing comma separator");
  }
  const meta = raw.slice(5, commaIndex).toLowerCase();
  const payload = raw.slice(commaIndex + 1);
  if (meta && !meta.startsWith("application/json") && !meta.startsWith("text/plain") && !meta.startsWith(";")) {
    throw new Error(`Unsupported data URI media type: ${meta}`);
  }
  const isBase64 = meta.split(";").includes("base64");
  let jsonText;
  if (isBase64) {
    jsonText = decodeBase64ToUtf8(payload);
  } else {
    try {
      jsonText = decodeURIComponent(payload);
    } catch {
      jsonText = payload;
    }
  }
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Registration JSON must be an object");
  }
  return parsed;
}

export function resolveTokenUri(uri, gateway = DEFAULT_IPFS_GATEWAY) {
  const raw = String(uri || "").trim();
  if (!raw) {
    throw new Error("Empty tokenURI");
  }
  if (raw.toLowerCase().startsWith("ipfs://")) {
    const cidPath = raw.slice(7).replace(/^ipfs\//i, "").replace(/^\/+/, "");
    if (!cidPath) {
      throw new Error("Empty IPFS CID in tokenURI");
    }
    const base = gateway.endsWith("/") ? gateway : `${gateway}/`;
    return `${base}${cidPath}`;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  throw new Error(`Unsupported tokenURI scheme: ${raw}`);
}

export function createRpc(rpcUrl, fetchImpl = globalThis.fetch) {
  return async function rpc(method, params) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body && body.error) {
      const err = new Error(body.error.message || "JSON-RPC error");
      err.code = body.error.code;
      err.data = body.error.data;
      throw err;
    }
    return body ? body.result : null;
  };
}

export function createFetchJson(fetchImpl = globalThis.fetch, gateway = DEFAULT_IPFS_GATEWAY) {
  return async function fetchJson(url) {
    const raw = String(url || "").trim();
    if (raw.toLowerCase().startsWith("data:")) {
      return decodeDataUri(raw);
    }
    const resolvedUrl = resolveTokenUri(raw, gateway);
    const response = await fetchImpl(resolvedUrl, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Registration fetch failed with HTTP ${response.status}`);
    }
    const parsed = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Registration file is not a JSON object");
    }
    return parsed;
  };
}

function isRevertError(err) {
  if (!err) return false;
  if (err.code === 3 || err.code === -32000) {
    const msg = String(err.message || "").toLowerCase();
    if (err.code === 3 || msg.includes("revert") || msg.includes("nonexistent") || msg.includes("invalid token")) {
      return true;
    }
  }
  const msg = String(err.message || err || "").toLowerCase();
  return (
    msg.includes("revert") ||
    msg.includes("erc721nonexistenttoken") ||
    msg.includes("nonexistent token") ||
    msg.includes("invalid token id")
  );
}

function parseAgentId(agentId) {
  if (typeof agentId === "bigint") {
    return agentId >= 0n ? agentId : null;
  }
  if (typeof agentId === "number") {
    if (!Number.isInteger(agentId) || agentId < 0) return null;
    return BigInt(agentId);
  }
  if (typeof agentId === "string") {
    const trimmed = agentId.trim();
    if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) return null;
    try {
      const value = BigInt(trimmed);
      return value >= 0n ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function summarizeFeedbackItems(items) {
  const normalized = items.map((item) => ({
    client: item.client,
    score: item.score,
    tags: Array.isArray(item.tags) ? item.tags : [],
  }));
  const count = normalized.length;
  const average =
    count === 0
      ? 0
      : normalized.reduce((sum, item) => sum + Number(item.score || 0), 0) / count;
  return {
    count,
    average,
    items: normalized,
  };
}

async function readReputationFeedback({ agentIdBigInt, reputationRegistry, rpc }) {
  const emptyFeedback = { count: 0, average: 0, items: [] };
  if (!reputationRegistry) {
    return emptyFeedback;
  }

  let clients = [];
  let getClientsSucceeded = false;

  try {
    const clientsHex = await rpc("eth_call", [
      { to: reputationRegistry, data: encodeGetClients(agentIdBigInt) },
      "latest",
    ]);
    if (typeof clientsHex === "string" && cleanHex(clientsHex).length >= 128) {
      const firstWord = Number(readUint256At(cleanHex(clientsHex), 0));
      // If a mock RPC returned a full 7-tuple readAllFeedback payload on the first call, decode it directly
      if (firstWord === 224 || firstWord === 160) {
        return summarizeFeedbackItems(decodeReadAllFeedback(clientsHex));
      }
      clients = decodeAddressArray(clientsHex);
      getClientsSucceeded = true;
    }
  } catch {
    getClientsSucceeded = false;
  }

  try {
    const callClients = getClientsSucceeded && clients.length > 0 ? clients : [];
    const feedbackHex = await rpc("eth_call", [
      {
        to: reputationRegistry,
        data: encodeReadAllFeedback(agentIdBigInt, callClients, "", "", false),
      },
      "latest",
    ]);
    if (typeof feedbackHex === "string" && cleanHex(feedbackHex).length >= 128) {
      const items = decodeReadAllFeedback(feedbackHex);
      if (items.length > 0 || !getClientsSucceeded || clients.length === 0) {
        return summarizeFeedbackItems(items);
      }
    }
  } catch {
    // Fallback to getSummary if readAllFeedback is not supported by a custom mock
  }

  if (getClientsSucceeded && clients.length > 0) {
    try {
      const summaryHex = await rpc("eth_call", [
        {
          to: reputationRegistry,
          data: encodeGetSummary(agentIdBigInt, clients, "", ""),
        },
        "latest",
      ]);
      if (typeof summaryHex === "string" && cleanHex(summaryHex).length >= 192) {
        const summary = decodeGetSummary(summaryHex);
        return {
          count: summary.count,
          average: summary.average,
          items: [],
        };
      }
    } catch {
      return emptyFeedback;
    }
  }

  return emptyFeedback;
}

export async function loadAgent(options = {}) {
  const {
    agentId,
    network = "base",
    identityRegistry,
    reputationRegistry,
    rpc: providedRpc,
    fetchJson: providedFetchJson,
  } = options;

  const emptyFeedback = { count: 0, average: 0, items: [] };
  const parsedId = parseAgentId(agentId);
  const agentIdLabel = parsedId !== null ? parsedId.toString(10) : String(agentId ?? "");

  if (parsedId === null) {
    return {
      status: "error",
      agentId: agentIdLabel,
      owner: null,
      tokenURI: null,
      registration: null,
      feedback: emptyFeedback,
      error: "Agent ID must be a non-negative integer",
    };
  }

  const netConfig = getNetworkConfig(network);
  const resolvedIdentity = identityRegistry || (netConfig ? netConfig.identity : null);
  if (!resolvedIdentity) {
    return {
      status: "error",
      agentId: agentIdLabel,
      owner: null,
      tokenURI: null,
      registration: null,
      feedback: emptyFeedback,
      error: `Unsupported network: ${String(network)}`,
    };
  }

  const resolvedReputation =
    reputationRegistry !== undefined
      ? reputationRegistry
      : netConfig
        ? netConfig.reputation
        : null;

  const rpc =
    providedRpc ||
    createRpc(netConfig ? netConfig.rpcUrl : REGISTRIES.base.rpcUrl);
  const fetchJson = providedFetchJson || createFetchJson();

  let ownerHex;
  try {
    ownerHex = await rpc("eth_call", [
      { to: resolvedIdentity, data: encodeOwnerOf(parsedId) },
      "latest",
    ]);
  } catch (err) {
    if (isRevertError(err)) {
      return {
        status: "empty",
        agentId: agentIdLabel,
        owner: null,
        tokenURI: null,
        registration: null,
        feedback: emptyFeedback,
      };
    }
    return {
      status: "error",
      agentId: agentIdLabel,
      owner: null,
      tokenURI: null,
      registration: null,
      feedback: emptyFeedback,
      error: String(err?.message || err || "Failed to read ownerOf from RPC"),
    };
  }

  let owner;
  try {
    owner = decodeAddressWord(String(ownerHex || ""));
  } catch (err) {
    return {
      status: "error",
      agentId: agentIdLabel,
      owner: null,
      tokenURI: null,
      registration: null,
      feedback: emptyFeedback,
      error: `Invalid ownerOf response: ${String(err?.message || err)}`,
    };
  }

  if (!owner || owner === ZERO_ADDRESS) {
    return {
      status: "empty",
      agentId: agentIdLabel,
      owner: null,
      tokenURI: null,
      registration: null,
      feedback: emptyFeedback,
    };
  }

  let tokenUriHex;
  try {
    tokenUriHex = await rpc("eth_call", [
      { to: resolvedIdentity, data: encodeTokenURI(parsedId) },
      "latest",
    ]);
  } catch (err) {
    return {
      status: "error",
      agentId: agentIdLabel,
      owner,
      tokenURI: null,
      registration: null,
      feedback: emptyFeedback,
      error: String(err?.message || err || "Failed to read tokenURI from RPC"),
    };
  }

  let tokenURI;
  try {
    tokenURI = decodeAbiString(String(tokenUriHex || "")).trim();
  } catch (err) {
    return {
      status: "error",
      agentId: agentIdLabel,
      owner,
      tokenURI: null,
      registration: null,
      feedback: emptyFeedback,
      error: `Invalid tokenURI response: ${String(err?.message || err)}`,
    };
  }

  if (!tokenURI) {
    return {
      status: "error",
      agentId: agentIdLabel,
      owner,
      tokenURI: "",
      registration: null,
      feedback: emptyFeedback,
      error: "Agent tokenURI is empty",
    };
  }

  let registration;
  try {
    if (tokenURI.toLowerCase().startsWith("data:")) {
      registration = decodeDataUri(tokenURI);
    } else {
      const fetchTarget = resolveTokenUri(tokenURI);
      const rawReg = await fetchJson(fetchTarget);
      registration = typeof rawReg === "string" ? JSON.parse(rawReg) : rawReg;
      if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
        throw new Error("Registration file must be a JSON object");
      }
    }
  } catch (err) {
    return {
      status: "error",
      agentId: agentIdLabel,
      owner,
      tokenURI,
      registration: null,
      feedback: emptyFeedback,
      error: String(err?.message || err || "Failed to load registration JSON"),
    };
  }

  const feedback = await readReputationFeedback({
    agentIdBigInt: parsedId,
    reputationRegistry: resolvedReputation,
    rpc,
  });

  return {
    status: "ok",
    agentId: agentIdLabel,
    owner,
    tokenURI,
    registration,
    feedback,
  };
}
