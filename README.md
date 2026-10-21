# ERC-8004 Identity Viewer

Zero-dependency browser viewer and ES module for inspecting ERC-8004 agent identities, registration files, and on-chain reputation feedback on Base (chain ID `8453`) and Base Sepolia (chain ID `84532`).

- **Live Viewer**: `https://195440.github.io/erc8004-identity-viewer/`
- **Repository**: `https://github.com/195440/erc8004-identity-viewer`

## Overview

Given an ERC-8004 `agentId` (`uint256`) and network (`base` or `base-sepolia`), this tool:

1. Reads `ownerOf(uint256)` and `tokenURI(uint256)` from the ERC-8004 Identity Registry (`ERC-721`).
2. Resolves the registration JSON from `data:application/json` (base64 or URL-encoded, decoded locally without network requests), `ipfs://` (mapped to `https://ipfs.io/ipfs/`), or `https://`.
3. Reads client feedback entries from the ERC-8004 Reputation Registry (`getClients` and `readAllFeedback`) and computes the non-revoked feedback count, average score, and item list (`client`, `score`, `tags`).

## Canonical Registry Addresses

Configured in [`config.js`](./config.js) from [`erc-8004/erc-8004-contracts`](https://github.com/erc-8004/erc-8004-contracts):

| Network | Chain ID | Identity Registry | Reputation Registry |
| --- | --- | --- | --- |
| `base` | `8453` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| `base-sepolia` | `84532` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Verified On-Chain Test Identities

Verified directly against `https://sepolia.base.org` and `https://mainnet.base.org`:

- **Base Sepolia (`84532`) Agent `0`**:
  - Owner: `0x21fded74c901129977b8e28c2588595163e1e235`
  - Name: `Test Agent 003 (Base)`
  - Description: `Testing Base Sepolia deployment`
  - Supported Trust: `["reputation"]`
  - Reputation Feedback: `44` non-revoked entries across `9` clients (average score `65.40`)
- **Base Mainnet (`8453`) Agent `0`**:
  - Owner: `0xa1daee3eb47f05f857aca817523f9ff11d95bd71`
  - Name: `Genesis Agent`
- **Base Mainnet (`8453`) Agent `1`**:
  - Owner: `0x89e9e1ab11dd1b138b1dce6d6a4a0926aafd5029`
  - Name: `ClawNews`
- **Base Mainnet (`8453`) Agent `395884`**:
  - Owner / Agent Wallet Relayer: `0x3c0820e2dabd5feae1fd03b78079dee15c7f83d8`
  - Associated Operator Wallet: `0x8cc9bd34b5ee8e828C54b84d0520CdCF4FA9C078`

## Programmatic Usage

```js
import { loadAgent, REGISTRIES } from "./viewer.js";

const result = await loadAgent({
  agentId: 0,
  network: "base-sepolia",
});

console.log(result.status); // "ok" | "empty" | "error"
console.log(result.owner);
console.log(result.registration);
console.log(result.feedback); // { count, average, items: [{ client, score, tags }] }
```

## Running Tests

Requires Node.js 20+. Tests run offline with `node:test`:

```bash
npm test
```

## License

MIT
