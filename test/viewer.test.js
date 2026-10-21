import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRIES, getNetworkConfig } from "../config.js";
import {
  SELECTORS,
  ZERO_ADDRESS,
  loadAgent,
  encodeAddressArray,
  encodeString,
  encodeReadAllFeedback,
} from "../viewer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function word(value) {
  const n = BigInt(value);
  const twos = n < 0n ? (1n << 256n) + n : n;
  return twos.toString(16).padStart(64, "0");
}

function encodeAddressResult(address) {
  return "0x" + String(address).toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeStringResult(str) {
  return "0x" + word(32) + encodeString(str);
}

function encodeUintArray(values) {
  return word(values.length) + values.map((v) => word(v)).join("");
}

function encodeStringArray(strings) {
  const encodedItems = strings.map((s) => encodeString(s));
  const offsets = [];
  let running = strings.length * 32;
  for (const item of encodedItems) {
    offsets.push(word(running));
    running += item.length / 2;
  }
  return word(strings.length) + offsets.join("") + encodedItems.join("");
}

function encodeFeedbackTuple(entries) {
  const clients = entries.map((e) => e.client);
  const indexes = entries.map((e, idx) => e.index ?? idx + 1);
  const values = entries.map((e) => e.value);
  const decimals = entries.map((e) => e.decimals ?? 0);
  const tag1s = entries.map((e) => e.tag1 ?? "");
  const tag2s = entries.map((e) => e.tag2 ?? "");
  const revoked = entries.map((e) => (e.revoked ? 1 : 0));

  const tails = [
    encodeAddressArray(clients),
    encodeUintArray(indexes),
    encodeUintArray(values),
    encodeUintArray(decimals),
    encodeStringArray(tag1s),
    encodeStringArray(tag2s),
    encodeUintArray(revoked),
  ];

  const headOffsets = [];
  let offset = tails.length * 32;
  for (const t of tails) {
    headOffsets.push(word(offset));
    offset += t.length / 2;
  }

  return "0x" + headOffsets.join("") + tails.join("");
}

test("A1: Existing agent renders owner, tokenURI and registration file fields (name, description, image, endpoints, supportedTrust)", async () => {
  const owner = "0x21fded74c901129977b8e28c2588595163e1e235";
  const tokenURI = "https://example.org/agents/42.json";
  const registrationData = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Kognai Genesis Explorer",
    description: "Autonomous verification agent on Base",
    image: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/avatar.png",
    endpoints: [
      { name: "MCP", endpoint: "https://agent.example.org/mcp", version: "2025-06-18" },
      { name: "A2A", endpoint: "https://agent.example.org/.well-known/agent-card.json", version: "0.3.0" },
    ],
    supportedTrust: ["reputation", "crypto-economic", "tee-attestation"],
  };

  const rpc = async (method, [call]) => {
    assert.equal(method, "eth_call");
    if (call.data.startsWith(SELECTORS.ownerOf)) {
      return encodeAddressResult(owner);
    }
    if (call.data.startsWith(SELECTORS.tokenURI)) {
      return encodeStringResult(tokenURI);
    }
    return "0x" + word(32) + word(0);
  };

  const fetchJson = async (url) => {
    assert.equal(url, tokenURI);
    return registrationData;
  };

  const result = await loadAgent({
    agentId: 42,
    network: "base",
    reputationRegistry: null,
    rpc,
    fetchJson,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.agentId, "42");
  assert.equal(result.owner, owner);
  assert.equal(result.tokenURI, tokenURI);
  assert.equal(result.registration.name, registrationData.name);
  assert.equal(result.registration.description, registrationData.description);
  assert.equal(result.registration.image, registrationData.image);
  assert.deepEqual(result.registration.endpoints, registrationData.endpoints);
  assert.deepEqual(result.registration.supportedTrust, registrationData.supportedTrust);
});

test("A2: ipfs:// and data: tokenURIs both resolve to the registration JSON without network calls for data URIs", async () => {
  const owner = "0xa1daee3eb47f05f857aca817523f9ff11d95bd71";
  const regObject = {
    name: "Genesis Agent",
    description: "First registered agent on Base",
    image: "https://example.com/genesis.png",
    endpoints: [{ name: "web", endpoint: "https://example.com" }],
    supportedTrust: ["reputation"],
  };

  // Case 1: ipfs:// mapped to https://ipfs.io/ipfs/ gateway
  let requestedUrl = null;
  const ipfsCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/agent.json";
  const ipfsRes = await loadAgent({
    agentId: 1,
    network: "base",
    reputationRegistry: null,
    rpc: async (_m, [call]) => {
      if (call.data.startsWith(SELECTORS.ownerOf)) return encodeAddressResult(owner);
      if (call.data.startsWith(SELECTORS.tokenURI)) return encodeStringResult(`ipfs://${ipfsCid}`);
      return "0x";
    },
    fetchJson: async (url) => {
      requestedUrl = url;
      return regObject;
    },
  });

  assert.equal(ipfsRes.status, "ok");
  assert.equal(requestedUrl, `https://ipfs.io/ipfs/${ipfsCid}`);
  assert.deepEqual(ipfsRes.registration, regObject);

  // Case 2: data:application/json;base64,... decoded without calling fetchJson
  const b64Payload = Buffer.from(JSON.stringify(regObject), "utf8").toString("base64");
  const dataBase64Uri = `data:application/json;base64,${b64Payload}`;
  let fetchCalled = false;

  const dataB64Res = await loadAgent({
    agentId: 2,
    network: "base",
    reputationRegistry: null,
    rpc: async (_m, [call]) => {
      if (call.data.startsWith(SELECTORS.ownerOf)) return encodeAddressResult(owner);
      if (call.data.startsWith(SELECTORS.tokenURI)) return encodeStringResult(dataBase64Uri);
      return "0x";
    },
    fetchJson: async () => {
      fetchCalled = true;
      throw new Error("fetchJson must not be called for data: URIs");
    },
  });

  assert.equal(dataB64Res.status, "ok");
  assert.equal(fetchCalled, false);
  assert.deepEqual(dataB64Res.registration, regObject);

  // Case 3: plain URL-encoded data:application/json,... decoded without calling fetchJson
  const dataPlainUri = `data:application/json,${encodeURIComponent(JSON.stringify(regObject))}`;
  const dataPlainRes = await loadAgent({
    agentId: 3,
    network: "base",
    reputationRegistry: null,
    rpc: async (_m, [call]) => {
      if (call.data.startsWith(SELECTORS.ownerOf)) return encodeAddressResult(owner);
      if (call.data.startsWith(SELECTORS.tokenURI)) return encodeStringResult(dataPlainUri);
      return "0x";
    },
    fetchJson: async () => {
      throw new Error("fetchJson must not be called for plain data: URIs");
    },
  });

  assert.equal(dataPlainRes.status, "ok");
  assert.deepEqual(dataPlainRes.registration, regObject);
});

test("A3: Non-existent agent shows an empty state; broken tokenURI or RPC error shows a clear message and never throws", async () => {
  // 1. ownerOf reverts with code 3 -> status: "empty"
  const revertedRes = await loadAgent({
    agentId: 99999999,
    network: "base",
    rpc: async () => {
      const err = new Error("execution reverted: ERC721NonexistentToken(99999999)");
      err.code = 3;
      throw err;
    },
  });
  assert.equal(revertedRes.status, "empty");
  assert.equal(revertedRes.owner, null);

  // 2. ownerOf returns zero address -> status: "empty"
  const zeroAddrRes = await loadAgent({
    agentId: 8888,
    network: "base",
    rpc: async () => encodeAddressResult(ZERO_ADDRESS),
  });
  assert.equal(zeroAddrRes.status, "empty");

  // 3. RPC network failure -> status: "error" with plain message, never throws
  const rpcErrorRes = await loadAgent({
    agentId: 1,
    network: "base",
    rpc: async () => {
      throw new Error("RPC upstream timeout after 5000ms");
    },
  });
  assert.equal(rpcErrorRes.status, "error");
  assert.match(rpcErrorRes.error, /timeout/i);

  // 4. Broken tokenURI fetch -> status: "error" with plain message, never throws
  const brokenUriRes = await loadAgent({
    agentId: 5,
    network: "base",
    rpc: async (_m, [call]) => {
      if (call.data.startsWith(SELECTORS.ownerOf)) {
        return encodeAddressResult("0x1111111111111111111111111111111111111111");
      }
      return encodeStringResult("ipfs://bafybroken/missing.json");
    },
    fetchJson: async () => {
      throw new Error("Gateway HTTP 504");
    },
  });
  assert.equal(brokenUriRes.status, "error");
  assert.match(brokenUriRes.error, /504/);
});

test("A4: Reputation entries are read and summarized when present; agents with no feedback show that clearly", async () => {
  const owner = "0x21fded74c901129977b8e28c2588595163e1e235";
  const clientA = "0x142b204dd6b4e1f9a637518688266972c53519f2";
  const clientB = "0x7c41d01c95f55c5590e65c8f91b4f854316d1da4";

  const encodedClients = "0x" + word(32) + encodeAddressArray([clientA, clientB]);
  const encodedFeedback = encodeFeedbackTuple([
    { client: clientA, index: 1, value: 900, decimals: 1, tag1: "quality", tag2: "speed", revoked: false },
    { client: clientB, index: 1, value: 80, decimals: 0, tag1: "accuracy", tag2: "", revoked: false },
    { client: clientB, index: 2, value: 10, decimals: 0, tag1: "revoked-item", tag2: "", revoked: true },
  ]);

  const withFeedback = await loadAgent({
    agentId: 0,
    network: "base-sepolia",
    rpc: async (_m, [call]) => {
      if (call.data.startsWith(SELECTORS.ownerOf)) return encodeAddressResult(owner);
      if (call.data.startsWith(SELECTORS.tokenURI)) {
        return encodeStringResult('data:application/json,{"name":"Agent Zero"}');
      }
      if (call.data.startsWith(SELECTORS.getClients)) return encodedClients;
      if (call.data.startsWith(SELECTORS.readAllFeedback)) {
        // Verify ABI encoding matches (uint256, address[], string, string, bool)
        assert.equal(
          call.data,
          encodeReadAllFeedback(0n, [clientA, clientB], "", "", false)
        );
        return encodedFeedback;
      }
      throw new Error(`Unexpected selector: ${call.data.slice(0, 10)}`);
    },
  });

  assert.equal(withFeedback.status, "ok");
  assert.equal(withFeedback.feedback.count, 2);
  assert.equal(withFeedback.feedback.average, 85);
  assert.deepEqual(withFeedback.feedback.items, [
    { client: clientA, score: 90, tags: ["quality", "speed"] },
    { client: clientB, score: 80, tags: ["accuracy"] },
  ]);

  // Agent with zero feedback entries
  const noFeedback = await loadAgent({
    agentId: 10,
    network: "base-sepolia",
    rpc: async (_m, [call]) => {
      if (call.data.startsWith(SELECTORS.ownerOf)) return encodeAddressResult(owner);
      if (call.data.startsWith(SELECTORS.tokenURI)) {
        return encodeStringResult('data:application/json,{"name":"Fresh Agent"}');
      }
      if (call.data.startsWith(SELECTORS.getClients)) {
        return "0x" + word(32) + word(0);
      }
      if (call.data.startsWith(SELECTORS.readAllFeedback)) {
        return encodeFeedbackTuple([]);
      }
      return "0x";
    },
  });

  assert.equal(noFeedback.status, "ok");
  assert.deepEqual(noFeedback.feedback, { count: 0, average: 0, items: [] });
});

test("A5: Works against both Base (8453) and Base Sepolia (84532) and reads the Base Sepolia test identity", async () => {
  assert.equal(REGISTRIES.base.chainId, 8453);
  assert.equal(REGISTRIES.base.identity, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
  assert.equal(REGISTRIES.base.reputation, "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");

  assert.equal(REGISTRIES["base-sepolia"].chainId, 84532);
  assert.equal(REGISTRIES["base-sepolia"].identity, "0x8004A818BFB912233c491871b3d84c89A494BD9e");
  assert.equal(REGISTRIES["base-sepolia"].reputation, "0x8004B663056A597Dffe9eCcC1965A193B7388713");
  assert.equal(getNetworkConfig("base-sepolia").identity, REGISTRIES["base-sepolia"].identity);

  // Recorded fixture of Base Sepolia Agent #0 ("Test Agent 003 (Base)")
  const sepoliaOwner = "0x21fded74c901129977b8e28c2588595163e1e235";
  const sepoliaTokenUri =
    "data:application/json;base64,eyJ0eXBlIjoiaHR0cHM6Ly9laXBzLmV0aGVyZXVtLm9yZy9FSVBTL2VpcC04MDA0I3JlZ2lzdHJhdGlvbi12MSIsIm5hbWUiOiJUZXN0IEFnZW50IDAwMyAoQmFzZSkiLCJkZXNjcmlwdGlvbiI6IlRlc3RpbmcgQmFzZSBTZXBvbGlhIGRlcGxveW1lbnQiLCJpbWFnZSI6Imh0dHBzOi8vZXhhbXBsZS5jb20vYWdlbnQzLnBuZyIsImVuZHBvaW50cyI6W3sibmFtZSI6IndlYiIsImVuZHBvaW50IjoiaHR0cHM6Ly9leGFtcGxlLmNvbS90ZXN0In1dLCJyZWdpc3RyYXRpb25zIjpbXSwic3VwcG9ydGVkVHJ1c3QiOlsicmVwdXRhdGlvbiJdLCJhY3RpdmUiOnRydWUsIng0MDJzdXBwb3J0IjpmYWxzZX0=";

  const calledTargets = [];
  const res = await loadAgent({
    agentId: 0,
    network: "base-sepolia",
    rpc: async (_m, [call]) => {
      calledTargets.push(call.to);
      if (call.to === REGISTRIES["base-sepolia"].identity) {
        if (call.data.startsWith(SELECTORS.ownerOf)) return encodeAddressResult(sepoliaOwner);
        if (call.data.startsWith(SELECTORS.tokenURI)) return encodeStringResult(sepoliaTokenUri);
      }
      if (call.to === REGISTRIES["base-sepolia"].reputation) {
        if (call.data.startsWith(SELECTORS.getClients)) {
          return "0x" + word(32) + encodeAddressArray(["0x142b204dd6b4e1f9a637518688266972c53519f2"]);
        }
        if (call.data.startsWith(SELECTORS.readAllFeedback)) {
          return encodeFeedbackTuple([
            {
              client: "0x142b204dd6b4e1f9a637518688266972c53519f2",
              index: 1,
              value: 1500,
              decimals: 0,
              tag1: "glicko2-mu",
              tag2: "ipd",
              revoked: false,
            },
          ]);
        }
      }
      throw new Error("Unexpected call target");
    },
  });

  assert.equal(res.status, "ok");
  assert.equal(res.owner, sepoliaOwner);
  assert.equal(res.registration.name, "Test Agent 003 (Base)");
  assert.equal(res.feedback.count, 1);
  assert.equal(res.feedback.items[0].score, 1500);
  assert.ok(calledTargets.includes(REGISTRIES["base-sepolia"].identity));
  assert.ok(calledTargets.includes(REGISTRIES["base-sepolia"].reputation));
});

test("A6: Mobile-friendly, light and dark themes, and free of em-dashes or en-dashes", () => {
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*>/i);
  assert.match(html, /prefers-color-scheme:\s*dark/i);
  assert.match(html, /@media\s*\(max-width:\s*600px\)/i);

  for (const file of ["index.html", "viewer.js", "config.js", "README.md"]) {
    const filePath = path.join(repoRoot, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      assert.equal(
        /[\u2013\u2014]/.test(content),
        false,
        `${file} must not contain en-dash or em-dash characters`
      );
    }
  }
});
