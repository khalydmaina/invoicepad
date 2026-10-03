// Wallet address checks. A wrong character in a payment address sends the
// money somewhere nobody can get it back from, so every address is verified
// as far as its format allows before it is put on an invoice.

const Address = (() => {
  const NETWORKS = [
    { id: "ethereum", name: "Ethereum", standard: "ERC-20", family: "evm" },
    { id: "base", name: "Base", family: "evm" },
    { id: "arbitrum", name: "Arbitrum One", family: "evm" },
    { id: "optimism", name: "OP Mainnet", family: "evm" },
    { id: "polygon", name: "Polygon", family: "evm" },
    { id: "bnb", name: "BNB Chain", standard: "BEP-20", family: "evm" },
    { id: "avalanche", name: "Avalanche C-Chain", family: "evm" },
    { id: "solana", name: "Solana", family: "solana" },
    { id: "tron", name: "Tron", standard: "TRC-20", family: "tron" },
    { id: "other", name: "Other", family: "other" },
  ];

  function network(id) {
    return NETWORKS.find((entry) => entry.id === id) || NETWORKS[NETWORKS.length - 1];
  }

  // --- keccak-256 (the hash behind EVM address checksums) ---

  const MASK = (1n << 64n) - 1n;
  const ROUND_CONSTANTS = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];
  const ROTATIONS = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
  ];

  const rotl = (value, shift) =>
    shift === 0 ? value : ((value << BigInt(shift)) | (value >> BigInt(64 - shift))) & MASK;

  function permute(state) {
    for (const constant of ROUND_CONSTANTS) {
      const parity = [0, 1, 2, 3, 4].map(
        (x) => state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
      );
      for (let x = 0; x < 5; x++) {
        const mix = parity[(x + 4) % 5] ^ rotl(parity[(x + 1) % 5], 1);
        for (let y = 0; y < 25; y += 5) state[x + y] ^= mix;
      }
      const moved = new Array(25);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROTATIONS[x + 5 * y]);
        }
      }
      for (let y = 0; y < 25; y += 5) {
        for (let x = 0; x < 5; x++) {
          state[x + y] = moved[x + y] ^ (~moved[((x + 1) % 5) + y] & MASK & moved[((x + 2) % 5) + y]);
        }
      }
      state[0] ^= constant;
    }
  }

  function keccak256(bytes) {
    const rate = 136;
    const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
    padded.set(bytes);
    padded[bytes.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    const state = new Array(25).fill(0n);
    for (let offset = 0; offset < padded.length; offset += rate) {
      for (let lane = 0; lane < rate / 8; lane++) {
        let word = 0n;
        for (let byte = 7; byte >= 0; byte--) {
          word = (word << 8n) | BigInt(padded[offset + lane * 8 + byte]);
        }
        state[lane] ^= word;
      }
      permute(state);
    }
    const out = new Uint8Array(32);
    for (let index = 0; index < 32; index++) {
      out[index] = Number((state[index >> 3] >> BigInt(8 * (index & 7))) & 0xffn);
    }
    return out;
  }

  // --- sha-256 (the hash behind Tron address checksums) ---

  const SHA_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256(bytes) {
    const rotr = (value, shift) => (value >>> shift) | (value << (32 - shift));
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 2 ** 32));
    view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
    const hash = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let i = 0; i < 64; i++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const t1 = (h + s1 + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
      }
      [a, b, c, d, e, f, g, h].forEach((value, i) => (hash[i] = (hash[i] + value) >>> 0));
    }
    const out = new Uint8Array(32);
    hash.forEach((value, i) => new DataView(out.buffer).setUint32(i * 4, value));
    return out;
  }

  // --- encodings ---

  const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  // Returns null when the text has a character base58 does not use.
  function base58Decode(text) {
    let number = 0n;
    for (const char of text) {
      const digit = BASE58.indexOf(char);
      if (digit < 0) return null;
      number = number * 58n + BigInt(digit);
    }
    const bytes = [];
    while (number > 0n) {
      bytes.unshift(Number(number & 0xffn));
      number >>= 8n;
    }
    for (const char of text) {
      if (char !== "1") break;
      bytes.unshift(0);
    }
    return Uint8Array.from(bytes);
  }

  const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  // EIP-55: the capital letters in an EVM address are a checksum of the address.
  function toChecksumAddress(address) {
    const lower = address.slice(2).toLowerCase();
    const hash = toHex(keccak256(new TextEncoder().encode(lower)));
    let out = "0x";
    for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    return out;
  }

  // --- validation ---
  // Returns { level: "ok" | "warn" | "error", message, address }.
  // "warn" means the address is well formed but could not be fully verified.
  // `address` is the form to print (EVM addresses get their checksum capitals).

  function validateEvm(text) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
      return {
        level: "error",
        message: "This network uses addresses that are 0x followed by 40 letters and digits (0-9, a-f).",
      };
    }
    const checksummed = toChecksumAddress(text);
    const body = text.slice(2);
    if (body === body.toLowerCase() || body === body.toUpperCase()) {
      return {
        level: "warn",
        address: checksummed,
        message:
          "The format is right, but an all-lowercase address has no built-in typo check. " +
          "Copy it from your wallet again rather than typing it.",
      };
    }
    if (text !== checksummed) {
      return {
        level: "error",
        message: "This address fails its checksum: at least one character is wrong. Copy it from your wallet again.",
      };
    }
    return { level: "ok", address: checksummed, message: "Address checksum is valid." };
  }

  function validateSolana(text) {
    const bytes = base58Decode(text);
    if (!bytes || bytes.length !== 32) {
      return {
        level: "error",
        message: "A Solana address is 32 to 44 characters with no 0, O, I or l. This one does not decode.",
      };
    }
    return {
      level: "warn",
      address: text,
      message: "The format is right. Solana addresses have no built-in typo check, so compare it with your wallet.",
    };
  }

  function validateTron(text) {
    const bytes = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(text) ? base58Decode(text) : null;
    if (!bytes || bytes.length !== 25 || bytes[0] !== 0x41) {
      return { level: "error", message: "A Tron address starts with T and is 34 characters long." };
    }
    const check = sha256(sha256(bytes.slice(0, 21))).slice(0, 4);
    if (toHex(check) !== toHex(bytes.slice(21))) {
      return {
        level: "error",
        message: "This address fails its checksum: at least one character is wrong. Copy it from your wallet again.",
      };
    }
    return { level: "ok", address: text, message: "Address checksum is valid." };
  }

  function validate(networkId, input) {
    const text = String(input ?? "").trim();
    if (text === "") return { level: "error", message: "Paste the wallet address you want to be paid at." };
    if (/\s/.test(text)) return { level: "error", message: "An address has no spaces in it." };
    const { family } = network(networkId);
    if (family === "evm") return validateEvm(text);
    if (family === "solana") return validateSolana(text);
    if (family === "tron") return validateTron(text);
    return {
      level: "warn",
      address: text,
      message: "This network is not one this page can check, so compare the address with your wallet.",
    };
  }

  return { NETWORKS, network, keccak256, sha256, base58Decode, toHex, toChecksumAddress, validate };
})();

if (typeof module !== "undefined") module.exports = Address;
