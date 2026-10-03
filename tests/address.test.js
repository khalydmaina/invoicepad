const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Address = require("../address.js");

const { keccak256, sha256, toHex, toChecksumAddress, validate, base58Decode } = Address;
const utf8 = (text) => new TextEncoder().encode(text);

test("keccak-256 matches reference values", () => {
  // Reference hashes produced with Foundry's `cast keccak`.
  const vectors = [
    ["", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
    ["abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"],
    ["a".repeat(135), "34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446"],
    ["a".repeat(136), "a6c4d403279fe3e0af03729caada8374b5ca54d8065329a3ebcaeb4b60aa386e"],
    ["invoicepad ".repeat(40), "b075852f7918211300a74cac2ec55fc539ac2e0789de458fc126b19ab8c59bcb"],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(toHex(keccak256(utf8(input))), expected, `${input.length} bytes`);
  }
});

test("sha-256 matches Node's implementation", () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const input = crypto.randomBytes(length);
    const expected = crypto.createHash("sha256").update(input).digest("hex");
    assert.equal(toHex(sha256(input)), expected, `${length} bytes`);
  }
});

test("EIP-55 checksum addresses from the specification", () => {
  for (const address of [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ]) {
    assert.equal(toChecksumAddress(address.toLowerCase()), address);
    assert.deepEqual(validate("base", address).level, "ok");
    assert.equal(validate("ethereum", address).address, address);
  }
});

test("EVM: a single wrong character is caught", () => {
  const good = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  const typo = good.replace("6053", "6054");
  assert.equal(validate("base", typo).level, "error");
  assert.match(validate("base", typo).message, /checksum/);
  const wrongCase = good.replace("aA", "Aa");
  assert.equal(validate("base", wrongCase).level, "error");
});

test("EVM: lowercase is accepted with a warning and printed with its checksum", () => {
  const result = validate("polygon", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
  assert.equal(result.level, "warn");
  assert.equal(result.address, "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  assert.equal(validate("bnb", "0X5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED").level, "error");
});

test("EVM: malformed addresses", () => {
  for (const bad of [
    "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe",
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAedd",
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeg",
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  ]) {
    assert.equal(validate("arbitrum", bad).level, "error", bad);
  }
});

test("Solana addresses", () => {
  const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  assert.equal(base58Decode(usdcMint).length, 32);
  assert.equal(validate("solana", usdcMint).level, "warn");
  assert.equal(validate("solana", usdcMint).address, usdcMint);
  assert.equal(validate("solana", "11111111111111111111111111111111").level, "warn");
  // No checksum: an address with its last character missing can still decode
  // to 32 bytes, which is exactly why Solana addresses only ever get "warn".
  for (const bad of [
    usdcMint.slice(0, 20),
    usdcMint + "aa",
    usdcMint.replace("E", "0"),
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  ]) {
    assert.equal(validate("solana", bad).level, "error", bad);
  }
});

test("Tron addresses", () => {
  const usdtContract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  assert.equal(validate("tron", usdtContract).level, "ok");
  assert.equal(validate("tron", usdtContract).address, usdtContract);
  const typo = usdtContract.replace("GTC", "GTD");
  assert.equal(validate("tron", typo).level, "error");
  assert.match(validate("tron", typo).message, /checksum/);
  for (const bad of ["R7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", usdtContract + "t", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"]) {
    assert.equal(validate("tron", bad).level, "error", bad);
  }
});

test("empty, spaced and unknown-network input", () => {
  assert.equal(validate("base", "").level, "error");
  assert.equal(validate("base", "   ").level, "error");
  assert.equal(validate("base", "0x5aAeb6053F3E94C9b9A0 9f33669435E7Ef1BeAed").level, "error");
  assert.equal(validate("base", "  0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed \n").level, "ok");
  assert.equal(validate("other", "cosmos1abc").level, "warn");
  assert.equal(validate("nonsense", "cosmos1abc").level, "warn");
});

test("network table", () => {
  const ids = Address.NETWORKS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Address.network("tron").standard, "TRC-20");
  assert.equal(Address.network("missing").id, "other");
});
