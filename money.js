// Invoice arithmetic in whole minor units (cents), never floats.
// In JavaScript 1.15 * 100 is 114.99999999999999, and an invoice that is a
// cent out is an invoice someone has to email about.

const Money = (() => {
  // Quantities, prices and percentages are read to 4 decimal places.
  const SCALE = 4;

  const CURRENCIES = [
    { code: "USD", prefix: "$", decimals: 2 },
    { code: "EUR", prefix: "€", decimals: 2 },
    { code: "GBP", prefix: "£", decimals: 2 },
    { code: "NGN", prefix: "₦", decimals: 2 },
    { code: "KES", prefix: "KSh ", decimals: 2 },
    { code: "GHS", prefix: "GH₵", decimals: 2 },
    { code: "ZAR", prefix: "R ", decimals: 2 },
    { code: "CAD", prefix: "CA$", decimals: 2 },
    { code: "AUD", prefix: "A$", decimals: 2 },
    { code: "INR", prefix: "₹", decimals: 2 },
    { code: "AED", prefix: "AED ", decimals: 2 },
    { code: "SGD", prefix: "S$", decimals: 2 },
    { code: "CHF", prefix: "CHF ", decimals: 2 },
    { code: "BRL", prefix: "R$", decimals: 2 },
    { code: "MXN", prefix: "MX$", decimals: 2 },
    { code: "PHP", prefix: "₱", decimals: 2 },
    { code: "PKR", prefix: "Rs ", decimals: 2 },
    { code: "JPY", prefix: "¥", decimals: 0 },
    { code: "USDC", suffix: " USDC", decimals: 2 },
    { code: "USDT", suffix: " USDT", decimals: 2 },
  ];

  function currency(code) {
    return CURRENCIES.find((entry) => entry.code === code) || CURRENCIES[0];
  }

  // "1,250.5" at scale 4 is 12505000n. Returns null for anything that is not
  // a plain number with at most `scale` decimal places. Empty text is zero.
  function parse(text, scale = SCALE) {
    const value = String(text ?? "").replace(/[\s,_]/g, "");
    if (value === "") return 0n;
    const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value);
    if (!match || (match[2] === "" && !match[3])) return null;
    const fraction = match[3] || "";
    if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) return null;
    const digits = (match[2] || "0") + fraction.slice(0, scale).padEnd(scale, "0");
    if (digits.length > 40) return null;
    const amount = BigInt(digits);
    return match[1] === "-" ? -amount : amount;
  }

  // Divide and round half away from zero, the way people round money.
  function divRound(value, divisor) {
    const negative = value < 0n;
    const magnitude = negative ? -value : value;
    const rounded = (magnitude + divisor / 2n) / divisor;
    return negative ? -rounded : rounded;
  }

  // quantity x unit price, in minor units.
  function lineAmount(quantityText, priceText, decimals) {
    const quantity = parse(quantityText);
    const price = parse(priceText);
    if (quantity === null || price === null) return null;
    return divRound(quantity * price, 10n ** BigInt(2 * SCALE - decimals));
  }

  function percentOf(amount, percentText) {
    const percent = parse(percentText);
    if (percent === null) return null;
    return divRound(amount * percent, 100n * 10n ** BigInt(SCALE));
  }

  // Every figure on the invoice, in minor units. A field that cannot be read
  // counts as zero and is listed in `invalid` so the form can point at it.
  function totals(invoice) {
    const { decimals } = currency(invoice.currency);
    const invalid = [];
    const orZero = (value, name) => {
      if (value === null) invalid.push(name);
      return value ?? 0n;
    };

    const lines = invoice.items.map((item, index) =>
      orZero(lineAmount(item.quantity, item.price, decimals), `items.${index}`)
    );
    const subtotal = lines.reduce((sum, amount) => sum + amount, 0n);
    const discount = orZero(
      invoice.discountType === "amount"
        ? parse(invoice.discount, decimals)
        : percentOf(subtotal, invoice.discount),
      "discount"
    );
    const tax = orZero(percentOf(subtotal - discount, invoice.taxRate), "taxRate");
    const total = subtotal - discount + tax;
    const paid = orZero(parse(invoice.paid, decimals), "paid");
    return { lines, subtotal, discount, tax, total, paid, due: total - paid, invalid };
  }

  // 150000n in USD is "$1,500.00". `places` overrides the currency's decimals.
  function format(minor, code, places) {
    const { prefix = "", suffix = "" } = currency(code);
    const decimals = places ?? currency(code).decimals;
    const negative = minor < 0n;
    const digits = (negative ? -minor : minor).toString().padStart(decimals + 1, "0");
    const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = decimals ? "." + digits.slice(digits.length - decimals) : "";
    return `${negative ? "-" : ""}${prefix}${whole}${fraction}${suffix}`;
  }

  // A unit price as typed: "80" is "$80.00", but "0.0045" stays "$0.0045"
  // instead of being rounded to a misleading "$0.00". Unreadable text is "".
  function formatPrice(text, code) {
    let scaled = parse(text);
    if (scaled === null) return "";
    let places = SCALE;
    while (places > currency(code).decimals && scaled % 10n === 0n) {
      scaled /= 10n;
      places--;
    }
    return format(scaled, code, places);
  }

  return { CURRENCIES, currency, parse, divRound, lineAmount, percentOf, totals, format, formatPrice };
})();

if (typeof module !== "undefined") module.exports = Money;
