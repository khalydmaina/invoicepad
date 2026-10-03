const test = require("node:test");
const assert = require("node:assert/strict");
const Money = require("../money.js");

const { parse, lineAmount, percentOf, totals, format } = Money;

const invoice = (overrides) => ({
  currency: "USD",
  items: [],
  discountType: "percent",
  discount: "",
  taxRate: "",
  paid: "",
  ...overrides,
});

test("parsing numbers", () => {
  assert.equal(parse("1"), 10000n);
  assert.equal(parse("1.5"), 15000n);
  assert.equal(parse("1,250.50"), 12505000n);
  assert.equal(parse(".25"), 2500n);
  assert.equal(parse("-3"), -30000n);
  assert.equal(parse(""), 0n);
  assert.equal(parse("  "), 0n);
  assert.equal(parse(undefined), 0n);
  assert.equal(parse("19.99", 2), 1999n);
  assert.equal(parse("5", 0), 5n);
  assert.equal(parse("1.2500", 2), 125n);
});

test("unreadable numbers are null, not zero", () => {
  for (const bad of ["abc", "1.2.3", ".", "1e3", "$5", "--1", "1.23456"]) {
    assert.equal(parse(bad), null, bad);
  }
  assert.equal(parse("1.005", 2), null);
});

test("line amounts that floats get wrong", () => {
  // 1.15 * 100 = 114.99999999999999 and 3 * 19.99 = 59.97 only by luck.
  assert.equal(lineAmount("100", "1.15", 2), 11500n);
  assert.equal(lineAmount("3", "19.99", 2), 5997n);
  assert.equal(lineAmount("0.1", "0.2", 2), 2n);
  assert.equal(lineAmount("1.5", "85", 2), 12750n);
  assert.equal(lineAmount("7.25", "62.50", 2), 45313n); // 453.125 rounds up
  assert.equal(lineAmount("1", "-50", 2), -5000n);
  assert.equal(lineAmount("3", "1000", 0), 3000n);
  assert.equal(lineAmount("1", "abc", 2), null);
});

test("rounding is half away from zero", () => {
  assert.equal(lineAmount("1", "0.005", 2), 1n);
  assert.equal(lineAmount("1", "0.0049", 2), 0n);
  assert.equal(lineAmount("1", "-0.005", 2), -1n);
  assert.equal(percentOf(100n, "2.5"), 3n); // 2.5% of $1.00 is 2.5 cents
  assert.equal(percentOf(100050n, "7.5"), 7504n); // 75.0375 rounds to 75.04
  assert.equal(percentOf(10000n, "0"), 0n);
  assert.equal(percentOf(10000n, "x"), null);
});

test("totals for a normal invoice", () => {
  const result = totals(
    invoice({
      items: [
        { description: "Design", quantity: "12.5", price: "80" },
        { description: "Hosting", quantity: "1", price: "49.99" },
      ],
      discount: "10",
      taxRate: "7.5",
      paid: "200",
    })
  );
  assert.deepEqual(result.lines, [100000n, 4999n]);
  assert.equal(result.subtotal, 104999n);
  assert.equal(result.discount, 10500n); // 10% of 1049.99 = 104.999
  assert.equal(result.tax, 7087n); // 7.5% of 944.99 = 70.87425
  assert.equal(result.total, 101586n);
  assert.equal(result.due, 81586n);
  assert.deepEqual(result.invalid, []);
  assert.equal(result.subtotal - result.discount + result.tax, result.total);
});

test("fixed discount, zero-decimal currency, empty invoice", () => {
  const fixed = totals(
    invoice({ items: [{ quantity: "2", price: "150" }], discountType: "amount", discount: "25.50" })
  );
  assert.equal(fixed.discount, 2550n);
  assert.equal(fixed.total, 27450n);

  const yen = totals(invoice({ currency: "JPY", items: [{ quantity: "3", price: "1500" }], taxRate: "10" }));
  assert.equal(yen.total, 4950n);
  assert.equal(format(yen.total, "JPY"), "¥4,950");

  const empty = totals(invoice({}));
  assert.equal(empty.total, 0n);
  assert.equal(empty.due, 0n);
});

test("bad fields count as zero and are reported", () => {
  const result = totals(
    invoice({
      items: [
        { quantity: "1", price: "100" },
        { quantity: "two", price: "100" },
      ],
      discount: "ten",
      taxRate: "5",
      paid: "1.005",
    })
  );
  assert.deepEqual(result.invalid, ["items.1", "discount", "paid"]);
  assert.equal(result.subtotal, 10000n);
  assert.equal(result.total, 10500n);
  assert.equal(result.due, 10500n);
});

test("formatting", () => {
  assert.equal(format(150000n, "USD"), "$1,500.00");
  assert.equal(format(5n, "USD"), "$0.05");
  assert.equal(format(0n, "EUR"), "€0.00");
  assert.equal(format(-5000n, "GBP"), "-£50.00");
  assert.equal(format(120000000n, "NGN"), "₦1,200,000.00");
  assert.equal(format(150000n, "USDC"), "1,500.00 USDC");
  assert.equal(format(99999n, "AED"), "AED 999.99");
  assert.equal(format(100n, "NOPE"), "$1.00");
});

test("unit prices keep the precision that was typed", () => {
  assert.equal(Money.formatPrice("80", "USD"), "$80.00");
  assert.equal(Money.formatPrice("19.9", "USD"), "$19.90");
  assert.equal(Money.formatPrice("0.0045", "USD"), "$0.0045");
  assert.equal(Money.formatPrice("12.125", "EUR"), "€12.125");
  assert.equal(Money.formatPrice("1500", "JPY"), "¥1,500");
  assert.equal(Money.formatPrice("-50", "GBP"), "-£50.00");
  assert.equal(Money.formatPrice("", "USD"), "$0.00");
  assert.equal(Money.formatPrice("abc", "USD"), "");
});

test("every currency is well formed", () => {
  const codes = new Set();
  for (const entry of Money.CURRENCIES) {
    assert.ok(!codes.has(entry.code), entry.code);
    codes.add(entry.code);
    assert.ok(entry.prefix || entry.suffix, entry.code);
    assert.ok(entry.decimals === 0 || entry.decimals === 2, entry.code);
  }
});
