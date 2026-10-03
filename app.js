(() => {
  const STORE_KEY = "invoicepad.v1";
  const MAX_LOGO_BYTES = 300 * 1024;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOLLAR_LIKE = ["USD", "USDC", "USDT"];
  const TOKENS = ["USDC", "USDT"];

  const $ = (id) => document.getElementById(id);
  const editor = $("editor");
  const sheet = $("sheet");

  // --- dates ---

  function isoDate(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function addDays(iso, days) {
    const date = new Date(`${iso}T12:00:00`);
    date.setDate(date.getDate() + days);
    return isoDate(date);
  }

  // "2026-10-03" reads as "3 Oct 2026", which means the same in every country.
  function readableDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
  }

  // --- the invoice ---

  function blank() {
    const today = isoDate(new Date());
    return {
      number: "INV-0001",
      currency: "USD",
      issued: today,
      due: addDays(today, 14),
      from: { name: "", details: "" },
      to: { name: "", details: "" },
      items: [{ description: "", quantity: "1", price: "" }],
      discount: "",
      discountType: "percent",
      taxLabel: "Tax",
      taxRate: "",
      paid: "",
      bank: "",
      crypto: { enabled: false, token: "USDC", network: "base", networkName: "", address: "" },
      notes: "",
      logo: "",
      accent: "#0b6e4f",
    };
  }

  // Anything read from storage or a file goes through here, so a damaged or
  // hand-edited file can never put the page in a state it cannot draw.
  function normalise(data) {
    const base = blank();
    const source = data && typeof data === "object" ? data : {};
    const text = (value, fallback, max = 4000) =>
      typeof value === "string" ? value.slice(0, max) : fallback;
    const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    const part = (value) => (value && typeof value === "object" ? value : {});

    const items = (Array.isArray(source.items) ? source.items : base.items).slice(0, 200).map((item) => ({
      description: text(part(item).description, ""),
      quantity: text(part(item).quantity, "", 40),
      price: text(part(item).price, "", 40),
    }));
    const crypto = part(source.crypto);
    const logo = text(source.logo, "", MAX_LOGO_BYTES * 2);

    return {
      number: text(source.number, base.number, 60),
      currency: pick(source.currency, Money.CURRENCIES.map((entry) => entry.code), base.currency),
      issued: /^\d{4}-\d{2}-\d{2}$/.test(source.issued) ? source.issued : base.issued,
      due: /^\d{4}-\d{2}-\d{2}$/.test(source.due) ? source.due : "",
      from: { name: text(part(source.from).name, "", 200), details: text(part(source.from).details, "") },
      to: { name: text(part(source.to).name, "", 200), details: text(part(source.to).details, "") },
      items: items.length ? items : base.items,
      discount: text(source.discount, "", 40),
      discountType: pick(source.discountType, ["percent", "amount"], "percent"),
      taxLabel: text(source.taxLabel, base.taxLabel, 40),
      taxRate: text(source.taxRate, "", 40),
      paid: text(source.paid, "", 40),
      bank: text(source.bank, ""),
      crypto: {
        enabled: crypto.enabled === true,
        token: pick(crypto.token, TOKENS, "USDC"),
        network: pick(crypto.network, Address.NETWORKS.map((entry) => entry.id), "base"),
        networkName: text(crypto.networkName, "", 60),
        address: text(crypto.address, "", 120),
      },
      notes: text(source.notes, ""),
      logo: /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(logo) ? logo : "",
      accent: /^#[0-9a-f]{6}$/i.test(source.accent) ? source.accent : base.accent,
    };
  }

  function load() {
    try {
      const stored = localStorage.getItem(STORE_KEY);
      return stored ? normalise(JSON.parse(stored)) : blank();
    } catch {
      return blank();
    }
  }

  function store() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(invoice));
      $("save-status").textContent = "";
    } catch {
      $("save-status").textContent =
        "This browser could not store the invoice. Use Save file so you do not lose it.";
    }
  }

  let invoice = load();

  // "INV-0009" becomes "INV-0010"; a number with no digits at the end gets "-2".
  function nextNumber(number) {
    const match = /^(.*?)(\d+)$/.exec(number);
    if (!match) return number ? `${number}-2` : "INV-0001";
    return match[1] + String(BigInt(match[2]) + 1n).padStart(match[2].length, "0");
  }

  // --- reading and writing fields by their name, like "crypto.address" ---

  function getPath(path) {
    return path.split(".").reduce((value, key) => value[key], invoice);
  }

  function setPath(path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((target, key) => target[key], invoice)[last] = value;
  }

  function fillEditor() {
    for (const field of editor.elements) {
      if (!field.name || field.name.startsWith("items.")) continue;
      const value = getPath(field.name);
      if (field.type === "checkbox") field.checked = value;
      else field.value = value;
    }
    drawItems();
  }

  function drawItems() {
    const box = $("items");
    box.replaceChildren(
      ...invoice.items.map((item, index) => {
        const input = (key, label, extra = {}) =>
          h("input", { name: `items.${index}.${key}`, value: item[key], "aria-label": `${label}, item ${index + 1}`, ...extra });
        const remove = h("button", { type: "button", class: "remove", "aria-label": `Remove item ${index + 1}`, text: "×" });
        remove.addEventListener("click", () => {
          invoice.items.splice(index, 1);
          if (!invoice.items.length) invoice.items.push({ description: "", quantity: "1", price: "" });
          drawItems();
          changed();
        });
        return h(
          "div",
          { class: "item" },
          input("description", "Description", { placeholder: "What you did or sold" }),
          input("quantity", "Quantity", { inputmode: "decimal", "data-number": "rate" }),
          input("price", "Price", { inputmode: "decimal", placeholder: "0.00", "data-number": "rate" }),
          remove
        );
      })
    );
  }

  // --- small DOM builder; all text goes in as text, never as HTML ---

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false && child !== ""));
    return node;
  }

  function qrSvg(text) {
    const qr = qrcode(0, "Q");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    let path = "";
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (qr.isDark(row, column)) path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
    const size = count + quiet * 2;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code of the wallet address");
    svg.setAttribute("shape-rendering", "crispEdges");
    const background = document.createElementNS(ns, "rect");
    background.setAttribute("width", size);
    background.setAttribute("height", size);
    background.setAttribute("fill", "#fff");
    const modules = document.createElementNS(ns, "path");
    modules.setAttribute("d", path);
    modules.setAttribute("fill", "#000");
    svg.append(background, modules);
    return svg;
  }

  // --- stablecoin payment block ---

  // What the invoice should say about paying in crypto, or the reason it cannot yet.
  function cryptoState() {
    const { crypto } = invoice;
    if (!crypto.enabled) return { show: false };
    const net = Address.network(crypto.network);
    const customName = crypto.networkName.trim();
    if (net.family === "other" && !customName) {
      return { show: false, problem: "Name the network for the stablecoin payment.", check: null };
    }
    const check = Address.validate(crypto.network, crypto.address);
    if (check.level === "error") {
      return { show: false, check, problem: `Wallet address is not on the invoice yet. ${check.message}` };
    }
    const networkName = net.family === "other" ? customName : net.name;
    return {
      show: true,
      check,
      token: crypto.token,
      address: check.address,
      networkLabel: net.standard ? `${networkName} (${net.standard})` : networkName,
      networkName,
    };
  }

  // --- drawing the invoice ---

  function draw() {
    const sums = Money.totals(invoice);
    const money = (minor) => Money.format(minor, invoice.currency);
    const pay = cryptoState();
    sheet.style.setProperty("--paper-accent", invoice.accent);
    document.title = [invoice.number, invoice.to.name].filter(Boolean).join(" ") || "invoicepad";

    const lines = (value) => (value.trim() ? h("div", { class: "details", text: value.trim() }) : null);
    const named = (value, placeholder) =>
      value.trim()
        ? h("div", { class: "name", text: value.trim() })
        : h("div", { class: "name ghost", text: placeholder });

    const meta = h("table", null,
      h("tr", null, h("th", { text: "Number" }), h("td", { text: invoice.number })),
      h("tr", null, h("th", { text: "Issued" }), h("td", { text: readableDate(invoice.issued) })),
      invoice.due && h("tr", null, h("th", { text: "Due" }), h("td", { text: readableDate(invoice.due) }))
    );

    const rows = invoice.items
      .map((item, index) => ({ item, amount: sums.lines[index] }))
      .filter(({ item }) => item.description.trim() || item.price.trim())
      .map(({ item, amount }) =>
        h("tr", null,
          h("td", { text: item.description.trim() }),
          h("td", { class: "num", text: item.quantity.trim() || "0" }),
          h("td", { class: "num", text: Money.formatPrice(item.price, invoice.currency) }),
          h("td", { class: "num", text: money(amount) })
        )
      );
    if (!rows.length) {
      rows.push(h("tr", { class: "ghost" }, h("td", { text: "Your items appear here" }), h("td"), h("td"), h("td")));
    }

    const total = (label, amount, grand) =>
      h("tr", grand ? { class: "grand" } : null, h("td", { text: label }), h("td", { text: money(amount) }));
    const hasDiscount = sums.discount !== 0n;
    const hasTax = sums.tax !== 0n;
    const hasPaid = sums.paid !== 0n;
    const totals = h("table", { class: "totals" },
      (hasDiscount || hasTax) && total("Subtotal", sums.subtotal),
      hasDiscount && total(invoice.discountType === "percent" ? `Discount (${invoice.discount.trim()}%)` : "Discount", -sums.discount),
      hasTax && total(`${invoice.taxLabel.trim() || "Tax"} (${invoice.taxRate.trim()}%)`, sums.tax),
      total("Total", sums.total, !hasPaid),
      hasPaid && total("Paid", -sums.paid),
      hasPaid && total("Balance due", sums.due, true)
    );

    const methods = [];
    if (invoice.bank.trim()) {
      methods.push(h("div", { class: "method" }, h("h3", { text: "Bank transfer" }), h("div", { class: "bank", text: invoice.bank.trim() })));
    }
    if (pay.show) {
      const amount = sums.due > 0n
        ? DOLLAR_LIKE.includes(invoice.currency)
          ? `Amount: ${Money.format(sums.due, pay.token)}`
          : `Amount: the ${pay.token} equivalent of ${money(sums.due)} on the day you pay`
        : null;
      methods.push(
        h("div", { class: "method crypto" },
          qrSvg(pay.address),
          h("div", null,
            h("h3", { text: `${pay.token} on ${pay.networkLabel}` }),
            h("div", { class: "addr", text: pay.address }),
            amount && h("div", { text: amount }),
            h("div", {
              class: "only",
              text: `Send only ${pay.token} on the ${pay.networkName} network. Any other token or network can be lost for good.`,
            })
          )
        )
      );
    }

    sheet.replaceChildren(
      h("div", { class: "top" },
        h("div", { class: "from" },
          invoice.logo && h("img", { class: "logo", src: invoice.logo, alt: "" }),
          named(invoice.from.name, "Your name or business"),
          lines(invoice.from.details)
        ),
        h("div", { class: "meta" }, h("div", { class: "title", text: "Invoice" }), meta)
      ),
      h("div", { class: "to" }, h("div", { class: "label", text: "Bill to" }), named(invoice.to.name, "Client name"), lines(invoice.to.details)),
      h("table", { class: "items" },
        h("thead", null, h("tr", null,
          h("th", { text: "Description" }),
          h("th", { class: "num", text: "Qty" }),
          h("th", { class: "num", text: "Price" }),
          h("th", { class: "num", text: "Amount" })
        )),
        h("tbody", null, rows)
      ),
      totals,
      methods.length > 0 && h("div", { class: "pay" }, h("div", { class: "label", text: "How to pay" }), h("div", { class: "pay-grid" }, methods)),
      invoice.notes.trim() && h("div", { class: "notes" }, h("div", { class: "label", text: "Notes" }), invoice.notes.trim())
    );

    drawEditorState(sums, pay);
  }

  // Feedback that lives in the form: bad numbers, the address check, hidden fields.
  function drawEditorState(sums, pay) {
    const decimals = Money.currency(invoice.currency).decimals;
    for (const field of editor.querySelectorAll("[data-number]")) {
      const kind = field.dataset.number;
      const fixedDiscount = kind === "discount" && invoice.discountType === "amount";
      const scale = kind === "money" || fixedDiscount ? decimals : undefined;
      if (Money.parse(field.value, scale) === null) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    }

    $("crypto-fields").hidden = !invoice.crypto.enabled;
    $("network-name").hidden = Address.network(invoice.crypto.network).family !== "other";
    const status = $("address-status");
    const check = invoice.crypto.enabled && invoice.crypto.address.trim() ? pay.check : null;
    status.textContent = check ? check.message : "";
    status.className = `status ${check ? check.level : ""}`;
    if (check && check.level === "error") $("address").setAttribute("aria-invalid", "true");
    else $("address").removeAttribute("aria-invalid");

    $("logo-clear").hidden = !invoice.logo;
    $("logo-pick").textContent = invoice.logo ? "Change logo" : "Add logo";

    const problems = [];
    if (sums.invalid.length) problems.push("Some numbers could not be read and count as zero. They are outlined in red.");
    if (pay.problem) problems.push(pay.problem);
    $("problems").replaceChildren(...problems.map((text) => h("li", { text })));
  }

  function changed() {
    store();
    draw();
  }

  // --- events ---

  editor.addEventListener("input", (event) => {
    const field = event.target;
    if (!field.name) return;
    setPath(field.name, field.type === "checkbox" ? field.checked : field.value);
    changed();
  });
  editor.addEventListener("submit", (event) => event.preventDefault());

  $("add-item").addEventListener("click", () => {
    invoice.items.push({ description: "", quantity: "1", price: "" });
    drawItems();
    changed();
    editor.querySelector(`[name="items.${invoice.items.length - 1}.description"]`).focus();
  });

  $("print").addEventListener("click", () => window.print());

  $("new").addEventListener("click", () => {
    const ok = confirm(
      "Start a new invoice?\n\nYour details and payment methods are kept. The client and items are cleared, so use Save file first if you need this one again."
    );
    if (!ok) return;
    const fresh = blank();
    invoice = {
      ...fresh,
      number: nextNumber(invoice.number),
      currency: invoice.currency,
      from: invoice.from,
      taxLabel: invoice.taxLabel,
      taxRate: invoice.taxRate,
      bank: invoice.bank,
      crypto: invoice.crypto,
      notes: invoice.notes,
      logo: invoice.logo,
      accent: invoice.accent,
    };
    fillEditor();
    changed();
  });

  $("save").addEventListener("click", () => {
    const file = new Blob([JSON.stringify({ app: "invoicepad", version: 1, invoice }, null, 2)], {
      type: "application/json",
    });
    const link = h("a", {
      href: URL.createObjectURL(file),
      download: `${invoice.number.replace(/[^\w.-]+/g, "_") || "invoice"}.json`,
    });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  $("open").addEventListener("click", () => $("open-file").click());
  $("open-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== "invoicepad" || !data.invoice) throw new Error("not an invoicepad file");
      invoice = normalise(data.invoice);
      fillEditor();
      changed();
    } catch {
      $("save-status").textContent = "That file is not an invoice saved from this page.";
    }
  });

  $("logo-pick").addEventListener("click", () => $("logo-file").click());
  $("logo-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    const status = $("logo-status");
    status.hidden = true;
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      status.textContent = "That image is over 300 KB. Use a smaller one so the invoice can be stored in your browser.";
      status.hidden = false;
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      invoice.logo = normalise({ logo: reader.result }).logo;
      if (!invoice.logo) {
        status.textContent = "Use a PNG, JPEG, WebP or SVG image.";
        status.hidden = false;
      }
      changed();
    });
    reader.readAsDataURL(file);
  });
  $("logo-clear").addEventListener("click", () => {
    invoice.logo = "";
    changed();
  });

  for (const tab of document.querySelectorAll(".tabs button")) {
    tab.addEventListener("click", () => {
      document.body.dataset.view = tab.dataset.view;
      for (const other of document.querySelectorAll(".tabs button")) {
        other.setAttribute("aria-pressed", String(other === tab));
      }
      window.scrollTo(0, 0);
    });
  }

  // --- start ---

  $("currency").replaceChildren(...Money.CURRENCIES.map((entry) => h("option", { text: entry.code })));
  $("network").replaceChildren(
    ...Address.NETWORKS.map((entry) =>
      h("option", { value: entry.id, text: entry.standard ? `${entry.name} (${entry.standard})` : entry.name })
    )
  );
  fillEditor();
  draw();
})();
