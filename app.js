const { useState, useEffect, useMemo, useCallback } = React;

/* ----------------------------------------------------------------------- */
/* Constants                                                               */
/* ----------------------------------------------------------------------- */

const STORAGE_KEY = "flight-tracker-data-v1";

const MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const KNOWN_AIRLINES = [
  "AIR INDIA EXPRESS", "INDIGO", "SPICE JET", "SPICEJET", "SALAM AIR",
  "AIR ARABIA", "FLYDUBAI", "FLY DUBAI", "GO FIRST", "ETIHAD",
  "EMIRATES", "AKASA AIR", "QATAR AIRWAYS", "OMAN AIR", "GULF AIR",
];

const CHART_COLORS = [
  "#4FB0C6", "#E8A33D", "#5FBF8A", "#E06C5C", "#8C7AE6",
  "#D6A2E8", "#6FA8DC", "#F2C14E", "#7FD1B9", "#C77DFF",
];

const todayISO = () => new Date().toISOString().slice(0, 10);

/* ----------------------------------------------------------------------- */
/* Parsing                                                                 */
/* ----------------------------------------------------------------------- */

function normRoutePart(s) {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

function resolveDate(day, monAbbr, pasteDateISO) {
  const month = MONTHS[monAbbr];
  if (month === undefined) return null;
  const pasteDate = new Date(pasteDateISO + "T00:00:00");
  let year = pasteDate.getFullYear();
  let candidate = new Date(year, month, parseInt(day, 10));
  const diffDays = (candidate - pasteDate) / 86400000;
  if (diffDays < -30) {
    candidate = new Date(year + 1, month, parseInt(day, 10));
  }
  const y = candidate.getFullYear();
  const m = String(candidate.getMonth() + 1).padStart(2, "0");
  const d = String(candidate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parsePastedText(text, pasteDateISO, pasteId) {
  const lines = text.split("\n").map((l) => l.trim());
  let currentAirline = null;
  let currentFlightCode = null;
  let currentOrigin = null;
  let currentDestination = null;
  let currentVariant = null;
  let justSawSeparator = true;
  const entries = [];
  const unparsed = [];

  for (const line of lines) {
    if (!line) continue;

    if (/^=+$/.test(line)) {
      justSawSeparator = true;
      currentVariant = null;
      continue;
    }

    const cleaned = line.replace(/\*/g, "").trim();

    const routeMatch = cleaned.match(/^([A-Z][A-Z\s]+?)\s+TO\s+([A-Z][A-Z\s]+)$/i);
    if (routeMatch && !/KG\s*BAGGAGE/i.test(line)) {
      currentOrigin = normRoutePart(routeMatch[1]);
      currentDestination = normRoutePart(routeMatch[2]);
      justSawSeparator = false;
      continue;
    }

    if (/KG\s*BAGGAGE/i.test(line)) {
      const fm = line.match(/🎒\s*([^\*\n]+)/);
      currentFlightCode = fm ? fm[1].replace(/\*/g, "").trim() : currentFlightCode;
      justSawSeparator = false;
      continue;
    }

    const variantMatch = cleaned.match(/^(MORNING|EVENING|AFTERNOON|NIGHT)\s+FLIGHT$/i);
    if (variantMatch) {
      currentVariant = variantMatch[1].toUpperCase();
      justSawSeparator = false;
      continue;
    }

    const upper = cleaned.toUpperCase();
    if (KNOWN_AIRLINES.includes(upper)) {
      currentAirline = upper === "SPICEJET" ? "SPICE JET" : upper === "FLY DUBAI" ? "FLYDUBAI" : upper;
      justSawSeparator = false;
      continue;
    }
    if (
      justSawSeparator &&
      /^[A-Z][A-Z\s]{2,28}$/.test(cleaned) &&
      !/\sTO\s/i.test(cleaned) &&
      !/KG|FLIGHT|BAGGAGE/i.test(cleaned)
    ) {
      currentAirline = upper;
      justSawSeparator = false;
      continue;
    }

    const dpMatch = line.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{3,6})(.*)$/);
    if (dpMatch && currentOrigin && currentDestination) {
      const [, day, monRaw, priceRaw, restRaw] = dpMatch;
      const monAbbr = monRaw.toUpperCase();
      const rest = restRaw || "";
      const dateISO = resolveDate(day, monAbbr, pasteDateISO);
      if (!dateISO) {
        unparsed.push(line);
        continue;
      }
      const flightOverride = rest.match(/\b([A-Z]{1,3}[\-\s]?\d{2,4})\b/);
      const seatMatch = rest.match(/(\d+)\s*SEAT/i);
      const timeMatch = rest.match(/MRNG|MORNING|EVENING/i);
      entries.push({
        id: `${pasteId}-${entries.length}-${Math.random().toString(36).slice(2, 7)}`,
        origin: currentOrigin,
        destination: currentDestination,
        airline: currentAirline || "UNKNOWN",
        flightNo: (flightOverride ? flightOverride[1] : currentFlightCode) || "",
        variant: currentVariant || (timeMatch ? timeMatch[0].toUpperCase() : null),
        date: dateISO,
        price: parseInt(priceRaw, 10),
        seats: seatMatch ? parseInt(seatMatch[1], 10) : null,
        pasteId,
        pasteDate: pasteDateISO,
      });
      justSawSeparator = false;
      continue;
    }

    if (
      cleaned.length > 2 &&
      !/KAT TYPING|WHATSAPP|CHANNEL|SHAHLA|AYISHA|RINSHA|BILAAL|JOURNEY|https?:\/\//i.test(cleaned)
    ) {
      unparsed.push(line);
    }
  }

  return { entries, unparsed };
}

/* ----------------------------------------------------------------------- */
/* Storage (localStorage — this is a standalone PWA, not a Claude artifact)*/
/* ----------------------------------------------------------------------- */

const emptyData = () => ({ entries: [], targets: {}, pastes: [] });

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      targets: parsed.targets || {},
      pastes: Array.isArray(parsed.pastes) ? parsed.pastes : [],
    };
  } catch (e) {
    return emptyData();
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ----------------------------------------------------------------------- */
/* Derived-data helpers                                                    */
/* ----------------------------------------------------------------------- */

const routeKeyOf = (e) => `${e.origin}||${e.destination}`;
const routeLabel = (key) => key.split("||").join(" \u2192 ");
const fmtDate = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const fmtDateFull = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function getRoutes(entries) {
  const map = new Map();
  entries.forEach((e) => {
    const k = routeKeyOf(e);
    if (!map.has(k)) map.set(k, { key: k, origin: e.origin, destination: e.destination, count: 0 });
    map.get(k).count += 1;
  });
  return Array.from(map.values()).sort((a, b) => routeLabel(a.key).localeCompare(routeLabel(b.key)));
}

function groupByPaste(entries) {
  const map = new Map();
  entries.forEach((e) => {
    if (!map.has(e.pasteId)) map.set(e.pasteId, { pasteId: e.pasteId, pasteDate: e.pasteDate, items: [] });
    map.get(e.pasteId).items.push(e);
  });
  return Array.from(map.values()).sort((a, b) => {
    if (a.pasteDate !== b.pasteDate) return a.pasteDate.localeCompare(b.pasteDate);
    return a.pasteId.localeCompare(b.pasteId);
  });
}

function computeRouteStats(entries, routeKey) {
  const routeEntries = entries.filter((e) => routeKeyOf(e) === routeKey);
  const pastes = groupByPaste(routeEntries);
  const latest = pastes[pastes.length - 1] || null;
  const prev = pastes.length > 1 ? pastes[pastes.length - 2] : null;

  let cheapest = null;
  if (latest) {
    cheapest = latest.items.reduce((min, cur) => (!min || cur.price < min.price ? cur : min), null);
  }

  const deltas = [];
  if (latest) {
    latest.items.forEach((item) => {
      let match = null;
      if (prev) {
        match =
          prev.items.find((p) => p.date === item.date && p.airline === item.airline && p.flightNo === item.flightNo) ||
          prev.items.find((p) => p.date === item.date && p.airline === item.airline) ||
          prev.items.find((p) => p.date === item.date) ||
          null;
      }
      deltas.push({ item, prevPrice: match ? match.price : null, delta: match ? item.price - match.price : null });
    });
    deltas.sort((a, b) => a.item.date.localeCompare(b.item.date) || a.item.price - b.item.price);
  }

  const datesInLatest = latest
    ? Array.from(new Set(latest.items.map((i) => i.date))).sort().slice(0, 10)
    : [];
  const trendData = pastes.map((p) => {
    const row = { pasteLabel: fmtDate(p.pasteDate), pasteDate: p.pasteDate };
    datesInLatest.forEach((d) => {
      const found = p.items.filter((i) => i.date === d);
      if (found.length) row[d] = Math.min(...found.map((i) => i.price));
    });
    return row;
  });

  const minTrend = pastes.map((p) => ({
    pasteLabel: fmtDate(p.pasteDate),
    minPrice: Math.min(...p.items.map((i) => i.price)),
  }));

  return { routeEntries, pastes, latest, prev, cheapest, deltas, datesInLatest, trendData, minTrend };
}

/* ----------------------------------------------------------------------- */
/* Tiny hand-rolled icon set (no icon library dependency)                  */
/* ----------------------------------------------------------------------- */

function Icon({ name, size = 14, className = "" }) {
  const s = size;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className };
  switch (name) {
    case "plane":
      return React.createElement("svg", common, React.createElement("path", { d: "M3 12l18-7-7 18-2-8-8-3z" }));
    case "paste":
      return React.createElement("svg", common,
        React.createElement("rect", { x: 6, y: 4, width: 12, height: 17, rx: 2 }),
        React.createElement("path", { d: "M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1" })
      );
    case "target":
      return React.createElement("svg", common,
        React.createElement("circle", { cx: 12, cy: 12, r: 8 }),
        React.createElement("circle", { cx: 12, cy: 12, r: 3 })
      );
    case "trend-down":
      return React.createElement("svg", common,
        React.createElement("path", { d: "M3 6l7 7 4-4 7 8" }),
        React.createElement("path", { d: "M21 12v5h-5" })
      );
    case "arrow-up":
      return React.createElement("svg", common, React.createElement("path", { d: "M6 18L18 6M18 6H9M18 6v9" }));
    case "arrow-down":
      return React.createElement("svg", common, React.createElement("path", { d: "M6 6l12 12M18 18H9M18 18V9" }));
    case "minus":
      return React.createElement("svg", common, React.createElement("path", { d: "M5 12h14" }));
    case "trash":
      return React.createElement("svg", common,
        React.createElement("path", { d: "M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13" })
      );
    case "x":
      return React.createElement("svg", common, React.createElement("path", { d: "M6 6l12 12M18 6L6 18" }));
    case "check":
      return React.createElement("svg", common, React.createElement("path", { d: "M4 12l6 6L20 6" }));
    case "chevron-down":
      return React.createElement("svg", common, React.createElement("path", { d: "M6 9l6 6 6-6" }));
    case "grid":
      return React.createElement("svg", common,
        React.createElement("rect", { x: 3, y: 3, width: 7, height: 7 }),
        React.createElement("rect", { x: 14, y: 3, width: 7, height: 7 }),
        React.createElement("rect", { x: 3, y: 14, width: 7, height: 7 }),
        React.createElement("rect", { x: 14, y: 14, width: 7, height: 7 })
      );
    case "alert":
      return React.createElement("svg", common,
        React.createElement("path", { d: "M12 9v4M12 17h.01" }),
        React.createElement("path", { d: "M10.3 3.9L2.7 18a1.6 1.6 0 001.4 2.4h15.8a1.6 1.6 0 001.4-2.4L13.7 3.9a1.6 1.6 0 00-2.8 0z" })
      );
    case "download":
      return React.createElement("svg", common,
        React.createElement("path", { d: "M12 3v12m0 0l-4-4m4 4l4-4M4 20h16" })
      );
    case "upload":
      return React.createElement("svg", common,
        React.createElement("path", { d: "M12 21V9m0 0l-4 4m4-4l4 4M4 4h16" })
      );
    default:
      return null;
  }
}

/* ----------------------------------------------------------------------- */
/* Hand-rolled SVG charts (no charting library dependency)                 */
/* ----------------------------------------------------------------------- */

function TrendChart({ data, lines, height = 240 }) {
  const W = 600, H = height, padL = 40, padR = 12, padT = 10, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const allVals = [];
  data.forEach((row) => lines.forEach((l) => { if (typeof row[l.key] === "number") allVals.push(row[l.key]); }));
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 1;
  const pad = (maxV - minV) * 0.1 || 50;
  const yMin = Math.max(0, minV - pad), yMax = maxV + pad;

  const xFor = (i) => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yFor = (v) => padT + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);

  return React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height, style: { display: "block" } },
    tickVals.map((t, i) => React.createElement("line", {
      key: "grid" + i, x1: padL, x2: W - padR, y1: yFor(t), y2: yFor(t), stroke: "#22303E", strokeWidth: 1,
    })),
    tickVals.map((t, i) => React.createElement("text", {
      key: "ytick" + i, x: padL - 6, y: yFor(t) + 3, textAnchor: "end", fontSize: 10, fill: "#5B7086", fontFamily: "ui-monospace, monospace",
    }, Math.round(t))),
    data.map((row, i) => (i % Math.ceil(data.length / 8 || 1) === 0 || i === data.length - 1) && React.createElement("text", {
      key: "xtick" + i, x: xFor(i), y: H - 6, textAnchor: "middle", fontSize: 10, fill: "#5B7086",
    }, row.pasteLabel)),
    lines.map((l, li) => {
      let d = "";
      let started = false;
      data.forEach((row, i) => {
        const v = row[l.key];
        if (typeof v === "number") {
          d += (started ? "L" : "M") + xFor(i) + "," + yFor(v) + " ";
          started = true;
        } else {
          started = false;
        }
      });
      return React.createElement("g", { key: l.key },
        React.createElement("path", { d, fill: "none", stroke: l.color, strokeWidth: 2 }),
        data.map((row, i) => typeof row[l.key] === "number" && React.createElement("circle", {
          key: i, cx: xFor(i), cy: yFor(row[l.key]), r: 2.6, fill: l.color,
        }, React.createElement("title", null, `${row.pasteLabel}: ${row[l.key]} AED`)))
      );
    })
  );
}

function Sparkline({ data, dataKey, height = 60, color = "#4FB0C6" }) {
  const W = 260, H = height, pad = 4;
  const vals = data.map((d) => d[dataKey]).filter((v) => typeof v === "number");
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const xFor = (i) => pad + (data.length <= 1 ? (W - 2 * pad) / 2 : (i / (data.length - 1)) * (W - 2 * pad));
  const yFor = (v) => H - pad - ((v - minV) / range) * (H - 2 * pad);
  let d = "";
  data.forEach((row, i) => {
    const v = row[dataKey];
    d += (i === 0 ? "M" : "L") + xFor(i) + "," + yFor(v) + " ";
  });
  return React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height, style: { display: "block" } },
    React.createElement("path", { d, fill: "none", stroke: color, strokeWidth: 2 }),
    data.map((row, i) => React.createElement("circle", {
      key: i, cx: xFor(i), cy: yFor(row[dataKey]), r: 2, fill: color,
    }, React.createElement("title", null, `${row.pasteLabel}: ${row[dataKey]} AED`)))
  );
}

/* ----------------------------------------------------------------------- */
/* Small UI atoms                                                          */
/* ----------------------------------------------------------------------- */

function Delta({ delta }) {
  if (delta === null || delta === undefined) {
    return React.createElement("span", { className: "text-[11px] text-slate-500" }, "new");
  }
  if (delta === 0) {
    return React.createElement("span", { className: "inline-flex items-center gap-1 text-[11px] text-slate-400" },
      React.createElement(Icon, { name: "minus", size: 11 }), "0");
  }
  const down = delta < 0;
  return React.createElement("span", { className: `inline-flex items-center gap-1 text-[11px] font-mono ${down ? "text-emerald-400" : "text-rose-400"}` },
    React.createElement(Icon, { name: down ? "arrow-down" : "arrow-up", size: 12 }),
    (down ? "" : "+") + delta
  );
}

function Money({ value }) {
  return React.createElement("span", { className: "font-mono tabular-nums" }, value?.toLocaleString("en-AE"));
}

/* ----------------------------------------------------------------------- */
/* Paste / Parse panel                                                     */
/* ----------------------------------------------------------------------- */

function PastePanel({ onCommit, onCancel }) {
  const [text, setText] = useState("");
  const [pasteDate, setPasteDate] = useState(todayISO());
  const [preview, setPreview] = useState(null);
  const [removed, setRemoved] = useState(new Set());

  const handleParse = () => {
    const pasteId = `paste-${Date.now()}`;
    const result = parsePastedText(text, pasteDate, pasteId);
    setPreview(result);
    setRemoved(new Set());
  };

  const toggleRemove = (id) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = () => {
    if (!preview) return;
    const keep = preview.entries.filter((e) => !removed.has(e.id));
    onCommit(keep, pasteDate);
  };

  return React.createElement("div", { className: "rounded-2xl border border-[#26374A] bg-[#16212C] p-5" },
    React.createElement("div", { className: "flex items-center justify-between mb-4" },
      React.createElement("h2", { className: "text-[15px] font-semibold text-slate-100" }, "Paste today's update"),
      React.createElement("button", { onClick: onCancel, className: "text-slate-500 hover:text-slate-300" }, React.createElement(Icon, { name: "x", size: 18 }))
    ),
    !preview && React.createElement(React.Fragment, null,
      React.createElement("div", { className: "flex items-center gap-3 mb-3" },
        React.createElement("label", { className: "text-[12px] text-slate-400" }, "Date this list is for"),
        React.createElement("input", {
          type: "date", value: pasteDate, onChange: (e) => setPasteDate(e.target.value),
          className: "bg-[#0F1720] border border-[#26374A] rounded-lg px-2 py-1 text-[12px] text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-[#4FB0C6]",
        })
      ),
      React.createElement("textarea", {
        value: text, onChange: (e) => setText(e.target.value),
        placeholder: "Paste the full WhatsApp message here, as-is...",
        className: "w-full h-56 bg-[#0F1720] border border-[#26374A] rounded-xl p-3 text-[12.5px] leading-relaxed text-slate-200 font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#4FB0C6] resize-none",
      }),
      React.createElement("div", { className: "flex justify-end mt-3" },
        React.createElement("button", {
          onClick: handleParse, disabled: !text.trim(),
          className: "inline-flex items-center gap-2 bg-[#4FB0C6] disabled:bg-[#2B3D48] disabled:text-slate-500 text-[#0B1720] font-medium text-[13px] px-4 py-2 rounded-lg hover:bg-[#63c1d6]",
        }, React.createElement(Icon, { name: "paste", size: 15 }), "Parse text")
      )
    ),
    preview && React.createElement(React.Fragment, null,
      React.createElement("div", { className: "flex items-center justify-between mb-3" },
        React.createElement("p", { className: "text-[12.5px] text-slate-400" },
          "Found ", React.createElement("span", { className: "text-slate-200 font-medium" }, preview.entries.length),
          " fare rows across ", React.createElement("span", { className: "text-slate-200 font-medium" }, getRoutes(preview.entries).length),
          " routes for ", React.createElement("span", { className: "text-slate-200 font-mono" }, fmtDateFull(pasteDate)), "."
        ),
        React.createElement("button", { onClick: () => setPreview(null), className: "text-[12px] text-[#4FB0C6] hover:text-[#7ecddb]" }, "Re-parse")
      ),
      React.createElement("div", { className: "max-h-72 overflow-y-auto rounded-xl border border-[#26374A]" },
        React.createElement("table", { className: "w-full text-[12px]" },
          React.createElement("thead", { className: "sticky top-0 bg-[#1D2B38] text-slate-400" },
            React.createElement("tr", null,
              ["Route", "Airline", "Flight", "Date", ""].map((h, i) =>
                React.createElement("th", { key: i, className: `font-medium px-3 py-2 ${h === "" ? "" : "text-left"}` }, h)
              ),
              React.createElement("th", { className: "text-right font-medium px-3 py-2" }, "Price")
            )
          ),
          React.createElement("tbody", null,
            preview.entries.map((e) => React.createElement("tr", {
              key: e.id, className: `border-t border-[#22303E] ${removed.has(e.id) ? "opacity-35" : ""}`,
            },
              React.createElement("td", { className: "px-3 py-1.5 text-slate-300" }, `${e.origin} → ${e.destination}`),
              React.createElement("td", { className: "px-3 py-1.5 text-slate-400" }, e.airline + (e.variant ? ` (${e.variant})` : "")),
              React.createElement("td", { className: "px-3 py-1.5 text-slate-500 font-mono" }, e.flightNo),
              React.createElement("td", { className: "px-3 py-1.5 text-slate-400 font-mono" }, fmtDate(e.date)),
              React.createElement("td", { className: "px-2 py-1.5 text-right" },
                React.createElement("button", { onClick: () => toggleRemove(e.id), className: "text-slate-600 hover:text-rose-400" }, React.createElement(Icon, { name: "trash", size: 13 }))
              ),
              React.createElement("td", { className: "px-3 py-1.5 text-right text-slate-200 font-mono" }, e.price)
            ))
          )
        )
      ),
      preview.unparsed.length > 0 && React.createElement("details", { className: "mt-2" },
        React.createElement("summary", { className: "text-[11.5px] text-slate-500 cursor-pointer hover:text-slate-400" }, `${preview.unparsed.length} line(s) not recognised`),
        React.createElement("div", { className: "mt-1.5 text-[11px] text-slate-600 font-mono space-y-0.5 max-h-24 overflow-y-auto" },
          preview.unparsed.map((l, i) => React.createElement("div", { key: i }, l))
        )
      ),
      React.createElement("div", { className: "flex justify-end gap-2 mt-4" },
        React.createElement("button", { onClick: onCancel, className: "text-[13px] text-slate-400 hover:text-slate-200 px-3 py-2" }, "Discard"),
        React.createElement("button", {
          onClick: handleSave,
          className: "inline-flex items-center gap-2 bg-[#5FBF8A] text-[#0B1720] font-medium text-[13px] px-4 py-2 rounded-lg hover:bg-[#77d19f]",
        }, React.createElement(Icon, { name: "check", size: 15 }), `Save ${preview.entries.length - removed.size} rows to history`)
      )
    )
  );
}

/* ----------------------------------------------------------------------- */
/* Single route dashboard                                                  */
/* ----------------------------------------------------------------------- */

function RouteDashboard({ data, routeKey, onTargetChange }) {
  const stats = useMemo(() => computeRouteStats(data.entries, routeKey), [data.entries, routeKey]);
  const target = data.targets[routeKey] ?? "";
  const [targetInput, setTargetInput] = useState(target);
  useEffect(() => setTargetInput(target), [target, routeKey]);

  if (!stats.latest) {
    return React.createElement("p", { className: "text-slate-500 text-[13px]" }, "No data for this route yet.");
  }

  const targetNum = target === "" ? null : Number(target);
  const hitEntries = targetNum !== null ? stats.latest.items.filter((i) => i.price <= targetNum) : [];
  const lines = stats.datesInLatest.map((d, idx) => ({ key: d, color: CHART_COLORS[idx % CHART_COLORS.length], label: fmtDate(d) }));

  return React.createElement("div", { className: "space-y-5" },
    React.createElement("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-3" },
      React.createElement("div", { className: "rounded-xl border border-[#26374A] bg-[#16212C] p-4" },
        React.createElement("div", { className: "flex items-center gap-2 text-[11px] text-slate-500 mb-1.5" }, React.createElement(Icon, { name: "trend-down", size: 13 }), "Cheapest right now"),
        stats.cheapest
          ? React.createElement(React.Fragment, null,
              React.createElement("div", { className: "text-2xl text-slate-100" }, React.createElement(Money, { value: stats.cheapest.price }), " ", React.createElement("span", { className: "text-[12px] text-slate-500" }, "AED")),
              React.createElement("div", { className: "text-[12px] text-slate-400 mt-1" }, `${stats.cheapest.airline} · ${fmtDate(stats.cheapest.date)}${stats.cheapest.flightNo ? " · " + stats.cheapest.flightNo : ""}`)
            )
          : React.createElement("span", { className: "text-slate-600 text-[13px]" }, "—")
      ),
      React.createElement("div", { className: "rounded-xl border border-[#26374A] bg-[#16212C] p-4" },
        React.createElement("div", { className: "flex items-center gap-2 text-[11px] text-slate-500 mb-1.5" }, React.createElement(Icon, { name: "target", size: 13 }), "Target price (AED)"),
        React.createElement("input", {
          type: "number", value: targetInput, onChange: (e) => setTargetInput(e.target.value),
          onBlur: () => onTargetChange(routeKey, targetInput === "" ? null : Number(targetInput)),
          placeholder: "Not set",
          className: "w-full bg-transparent text-2xl text-slate-100 font-mono focus:outline-none placeholder:text-slate-600",
        }),
        targetNum !== null && React.createElement("div", { className: `text-[12px] mt-1 ${hitEntries.length ? "text-amber-400" : "text-slate-500"}` },
          hitEntries.length ? `${hitEntries.length} date(s) at or below target` : "No dates at target yet")
      ),
      React.createElement("div", { className: "rounded-xl border border-[#26374A] bg-[#16212C] p-4" },
        React.createElement("div", { className: "flex items-center gap-2 text-[11px] text-slate-500 mb-1.5" }, React.createElement(Icon, { name: "paste", size: 13 }), "Tracking"),
        React.createElement("div", { className: "text-2xl text-slate-100" }, stats.pastes.length),
        React.createElement("div", { className: "text-[12px] text-slate-400 mt-1" }, `paste${stats.pastes.length !== 1 ? "s" : ""} · last ${fmtDate(stats.latest.pasteDate)}`)
      )
    ),
    hitEntries.length > 0 && React.createElement("div", { className: "flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3" },
      React.createElement(Icon, { name: "alert", size: 15, className: "text-amber-400 mt-0.5 shrink-0" }),
      React.createElement("p", { className: "text-[12.5px] text-amber-200" },
        hitEntries.map((i) => `${fmtDate(i.date)} on ${i.airline} at ${i.price} AED`).join(", "),
        " ", hitEntries.length === 1 ? "is" : "are", " at or under your target.")
    ),
    React.createElement("div", { className: "rounded-xl border border-[#26374A] bg-[#16212C] p-4" },
      React.createElement("h3", { className: "text-[13px] font-medium text-slate-300 mb-3" }, "Price trend across your pastes"),
      stats.trendData.length < 2
        ? React.createElement("p", { className: "text-[12.5px] text-slate-500" }, "Paste at least two days of prices to see a trend line.")
        : React.createElement(React.Fragment, null,
            React.createElement(TrendChart, { data: stats.trendData, lines }),
            React.createElement("div", { className: "flex flex-wrap gap-x-4 gap-y-1 mt-2" },
              lines.map((l) => React.createElement("div", { key: l.key, className: "flex items-center gap-1.5 text-[11px] text-slate-400" },
                React.createElement("span", { className: "w-2.5 h-2.5 rounded-full inline-block", style: { background: l.color } }), l.label))
            )
          )
    ),
    React.createElement("div", { className: "rounded-xl border border-[#26374A] bg-[#16212C] overflow-hidden" },
      React.createElement("div", { className: "px-4 py-3 border-b border-[#22303E] flex items-center justify-between" },
        React.createElement("h3", { className: "text-[13px] font-medium text-slate-300" }, `Latest snapshot · ${fmtDate(stats.latest.pasteDate)}`),
        stats.prev && React.createElement("span", { className: "text-[11px] text-slate-500" }, `vs ${fmtDate(stats.prev.pasteDate)}`)
      ),
      React.createElement("div", { className: "overflow-x-auto" },
        React.createElement("table", { className: "w-full text-[12.5px]" },
          React.createElement("thead", { className: "text-slate-500" },
            React.createElement("tr", null,
              React.createElement("th", { className: "text-left font-medium px-4 py-2" }, "Date"),
              React.createElement("th", { className: "text-left font-medium px-4 py-2" }, "Airline"),
              React.createElement("th", { className: "text-left font-medium px-4 py-2" }, "Flight"),
              React.createElement("th", { className: "text-right font-medium px-4 py-2" }, "Price"),
              React.createElement("th", { className: "text-right font-medium px-4 py-2" }, "Change")
            )
          ),
          React.createElement("tbody", null,
            stats.deltas.map(({ item, delta }) => React.createElement("tr", { key: item.id, className: "border-t border-[#22303E] hover:bg-[#1A2734]" },
              React.createElement("td", { className: "px-4 py-2 text-slate-300 font-mono" }, fmtDate(item.date)),
              React.createElement("td", { className: "px-4 py-2 text-slate-400" }, item.airline, item.variant ? React.createElement("span", { className: "text-slate-600" }, ` · ${item.variant}`) : null),
              React.createElement("td", { className: "px-4 py-2 text-slate-500 font-mono" }, item.flightNo),
              React.createElement("td", { className: "px-4 py-2 text-right text-slate-100 font-mono" }, React.createElement(Money, { value: item.price })),
              React.createElement("td", { className: "px-4 py-2 text-right" }, React.createElement(Delta, { delta }))
            ))
          )
        )
      )
    )
  );
}

/* ----------------------------------------------------------------------- */
/* Compare mode                                                            */
/* ----------------------------------------------------------------------- */

function CompareCard({ data, routeKey, onTargetChange }) {
  const stats = useMemo(() => computeRouteStats(data.entries, routeKey), [data.entries, routeKey]);
  const target = data.targets[routeKey] ?? "";
  const targetNum = target === "" || target === null || target === undefined ? null : Number(target);
  const hit = targetNum !== null && stats.cheapest && stats.cheapest.price <= targetNum;

  return React.createElement("div", { className: `rounded-xl border p-4 bg-[#16212C] ${hit ? "border-amber-500/40" : "border-[#26374A]"}` },
    React.createElement("div", { className: "flex items-center justify-between mb-2" },
      React.createElement("h3", { className: "text-[13px] font-medium text-slate-200" }, routeLabel(routeKey)),
      hit && React.createElement(Icon, { name: "target", size: 14, className: "text-amber-400" })
    ),
    stats.cheapest
      ? React.createElement(React.Fragment, null,
          React.createElement("div", { className: "text-xl text-slate-100" }, React.createElement(Money, { value: stats.cheapest.price }), " ", React.createElement("span", { className: "text-[11px] text-slate-500" }, "AED")),
          React.createElement("div", { className: "text-[11.5px] text-slate-400 mb-2" }, `${stats.cheapest.airline} · ${fmtDate(stats.cheapest.date)}`)
        )
      : React.createElement("p", { className: "text-slate-600 text-[12px] mb-2" }, "No data"),
    stats.minTrend.length >= 2 && React.createElement(Sparkline, { data: stats.minTrend, dataKey: "minPrice" }),
    React.createElement("div", { className: "flex items-center gap-2 mt-2" },
      React.createElement("span", { className: "text-[11px] text-slate-500" }, "Target"),
      React.createElement("input", {
        type: "number", defaultValue: target,
        onBlur: (e) => onTargetChange(routeKey, e.target.value === "" ? null : Number(e.target.value)),
        placeholder: "—",
        className: "w-20 bg-[#0F1720] border border-[#26374A] rounded px-2 py-1 text-[12px] text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-[#4FB0C6]",
      })
    )
  );
}

/* ----------------------------------------------------------------------- */
/* Main app                                                                */
/* ----------------------------------------------------------------------- */

function FlightPriceTracker() {
  const [data, setData] = useState(() => loadData());
  const [showPaste, setShowPaste] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [compareRoutes, setCompareRoutes] = useState([]);
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const routes = getRoutes(data.entries);
    if (!selectedRoute && routes.length) setSelectedRoute(routes[0].key);
    // eslint-disable-next-line
  }, []);

  const routes = useMemo(() => getRoutes(data.entries), [data]);

  const persist = (next) => {
    setData(next);
    saveData(next);
  };

  const commitPaste = useCallback((newEntries, pasteDate) => {
    if (!newEntries.length) return;
    const pasteId = newEntries[0].pasteId;
    const next = {
      entries: [...data.entries, ...newEntries],
      targets: data.targets,
      pastes: [...data.pastes, { id: pasteId, date: pasteDate, count: newEntries.length, timestamp: Date.now() }],
    };
    persist(next);
    setShowPaste(false);
    const newRoutes = getRoutes(next.entries);
    if (!selectedRoute && newRoutes.length) setSelectedRoute(newRoutes[0].key);
  }, [data, selectedRoute]);

  const handleTargetChange = useCallback((routeKey, value) => {
    const nextTargets = { ...data.targets };
    if (value === null) delete nextTargets[routeKey];
    else nextTargets[routeKey] = value;
    persist({ ...data, targets: nextTargets });
  }, [data]);

  const toggleCompareRoute = (key) => {
    setCompareRoutes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flight-prices-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        const existingIds = new Set(data.entries.map((e) => e.id));
        const mergedEntries = [...data.entries, ...(imported.entries || []).filter((e) => !existingIds.has(e.id))];
        const existingPasteIds = new Set(data.pastes.map((p) => p.id));
        const mergedPastes = [...data.pastes, ...(imported.pastes || []).filter((p) => !existingPasteIds.has(p.id))];
        const mergedTargets = { ...(imported.targets || {}), ...data.targets };
        persist({ entries: mergedEntries, targets: mergedTargets, pastes: mergedPastes });
        setToast(`Imported ${(imported.entries || []).length} rows.`);
      } catch (e) {
        setToast("Couldn't read that file — is it a valid export?");
      }
      setTimeout(() => setToast(null), 4000);
    };
    reader.readAsText(file);
  };

  return React.createElement("div", { className: "bg-[#0F1720] text-slate-200 rounded-2xl p-5 sm:p-6 min-h-screen" },
    React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-3 mb-5" },
      React.createElement("div", { className: "flex items-center gap-2.5" },
        React.createElement("div", { className: "w-9 h-9 rounded-lg bg-[#1D2B38] border border-[#26374A] flex items-center justify-center" },
          React.createElement(Icon, { name: "plane", size: 17, className: "text-[#4FB0C6]" })
        ),
        React.createElement("div", null,
          React.createElement("h1", { className: "text-[15px] font-semibold text-slate-100 leading-tight" }, "Flight Price Tracker"),
          React.createElement("p", { className: "text-[11.5px] text-slate-500 leading-tight" }, "Kerala \u2192 UAE fares, tracked over time")
        )
      ),
      React.createElement("div", { className: "flex items-center gap-2" },
        React.createElement("label", { className: "inline-flex items-center gap-1.5 text-[12.5px] px-3 py-2 rounded-lg border border-[#26374A] text-slate-400 hover:text-slate-200 cursor-pointer" },
          React.createElement(Icon, { name: "upload", size: 14 }), "Import",
          React.createElement("input", { type: "file", accept: "application/json", className: "hidden", onChange: (e) => e.target.files[0] && handleImportFile(e.target.files[0]) })
        ),
        React.createElement("button", {
          onClick: handleExport,
          className: "inline-flex items-center gap-1.5 text-[12.5px] px-3 py-2 rounded-lg border border-[#26374A] text-slate-400 hover:text-slate-200",
        }, React.createElement(Icon, { name: "download", size: 14 }), "Export JSON"),
        React.createElement("button", {
          onClick: () => setCompareMode((v) => !v),
          className: `inline-flex items-center gap-1.5 text-[12.5px] px-3 py-2 rounded-lg border ${compareMode ? "bg-[#1D2B38] border-[#4FB0C6] text-[#4FB0C6]" : "border-[#26374A] text-slate-400 hover:text-slate-200"}`,
        }, React.createElement(Icon, { name: "grid", size: 14 }), "Compare"),
        React.createElement("button", {
          onClick: () => setShowPaste(true),
          className: "inline-flex items-center gap-1.5 bg-[#4FB0C6] text-[#0B1720] font-medium text-[12.5px] px-3.5 py-2 rounded-lg hover:bg-[#63c1d6]",
        }, React.createElement(Icon, { name: "paste", size: 14 }), "Paste update")
      )
    ),
    toast && React.createElement("div", { className: "mb-4 text-[12px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2" }, toast),
    showPaste && React.createElement("div", { className: "mb-5" }, React.createElement(PastePanel, { onCommit: commitPaste, onCancel: () => setShowPaste(false) })),
    routes.length === 0 && !showPaste
      ? React.createElement("div", { className: "rounded-2xl border border-dashed border-[#26374A] py-16 text-center" },
          React.createElement(Icon, { name: "plane", size: 22, className: "mx-auto text-slate-600 mb-3" }),
          React.createElement("p", { className: "text-slate-400 text-[13.5px] mb-1" }, "No fares tracked yet"),
          React.createElement("p", { className: "text-slate-600 text-[12px] mb-4" }, "Paste your first WhatsApp price list to get started."),
          React.createElement("button", {
            onClick: () => setShowPaste(true),
            className: "inline-flex items-center gap-1.5 bg-[#4FB0C6] text-[#0B1720] font-medium text-[12.5px] px-4 py-2 rounded-lg hover:bg-[#63c1d6]",
          }, React.createElement(Icon, { name: "paste", size: 14 }), "Paste update")
        )
      : !compareMode
      ? React.createElement("div", { className: "flex flex-col md:flex-row gap-5" },
          React.createElement("div", { className: "md:w-56 shrink-0" },
            React.createElement("div", { className: "hidden md:block space-y-1" },
              routes.map((r) => React.createElement("button", {
                key: r.key, onClick: () => setSelectedRoute(r.key),
                className: `w-full text-left px-3 py-2 rounded-lg text-[12.5px] ${selectedRoute === r.key ? "bg-[#1D2B38] text-[#4FB0C6] border border-[#2E4657]" : "text-slate-400 hover:bg-[#161F29] border border-transparent"}`,
              }, routeLabel(r.key), React.createElement("span", { className: "block text-[10.5px] text-slate-600" }, `${r.count} fare${r.count !== 1 ? "s" : ""} tracked`)))
            ),
            React.createElement("div", { className: "md:hidden relative" },
              React.createElement("button", {
                onClick: () => setRoutePickerOpen((v) => !v),
                className: "w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-[#16212C] border border-[#26374A] text-[13px] text-slate-200",
              }, selectedRoute ? routeLabel(selectedRoute) : "Select route", React.createElement(Icon, { name: "chevron-down", size: 15, className: "text-slate-500" })),
              routePickerOpen && React.createElement("div", { className: "absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg bg-[#16212C] border border-[#26374A] shadow-lg" },
                routes.map((r) => React.createElement("button", {
                  key: r.key, onClick: () => { setSelectedRoute(r.key); setRoutePickerOpen(false); },
                  className: "w-full text-left px-3 py-2 text-[12.5px] text-slate-300 hover:bg-[#1D2B38]",
                }, routeLabel(r.key)))
              )
            )
          ),
          React.createElement("div", { className: "flex-1 min-w-0" },
            selectedRoute && React.createElement(RouteDashboard, { data, routeKey: selectedRoute, onTargetChange: handleTargetChange })
          )
        )
      : React.createElement("div", null,
          React.createElement("div", { className: "flex flex-wrap gap-1.5 mb-4" },
            routes.map((r) => React.createElement("button", {
              key: r.key, onClick: () => toggleCompareRoute(r.key),
              className: `text-[11.5px] px-2.5 py-1.5 rounded-full border ${compareRoutes.includes(r.key) ? "bg-[#1D2B38] border-[#4FB0C6] text-[#4FB0C6]" : "border-[#26374A] text-slate-500 hover:text-slate-300"}`,
            }, routeLabel(r.key)))
          ),
          compareRoutes.length === 0
            ? React.createElement("p", { className: "text-slate-500 text-[13px]" }, "Pick two or more routes above to compare their cheapest fares side by side.")
            : React.createElement("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" },
                compareRoutes.map((key) => React.createElement(CompareCard, { key, data, routeKey: key, onTargetChange: handleTargetChange }))
              )
        )
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(FlightPriceTracker));
