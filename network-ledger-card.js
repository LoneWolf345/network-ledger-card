/* Network Ledger Card — an editorial, almanac-style internet & network health panel
 * for Home Assistant. ISP uptime and incident streak computed live from recorded
 * history of an Uptime Kuma monitor; eero mesh nodes auto-discovered with
 * per-model glyphs; optional LTE-backup chip appears only when the network has it.
 * https://github.com/LoneWolf345/network-ledger-card
 */

const NLC_VERSION = "2026.8.2";

const INK = "#3a2d1f", PAPER = "#f3e7d3", TAN = "#a3876a", BROWN = "#7a6248",
  TERRA = "#c65f38", GREEN = "#4d7a52", AMBERC = "#b58a2e", DOT = "#cfb894";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r0 = (v) => (v == null || isNaN(v) ? "—" : Math.round(v));

/* eero model glyphs, ink style, 22x16 viewBox, stroke currentColor */
function nodeGlyph(model) {
  const m = String(model || "").toLowerCase();
  let g;
  if (/outdoor/.test(m)) {
    g = '<path d="M6 3 h10 a2 2 0 0 1 2 2 v5 a2 2 0 0 1 -2 2 h-10 a2 2 0 0 1 -2 -2 v-5 a2 2 0 0 1 2 -2 Z"/><path d="M11 12 v3 M8 15 h6"/><circle cx="11" cy="7.5" r="1.6"/>';
  } else if (/gateway/.test(m)) {
    g = '<rect x="2" y="5" width="18" height="7" rx="1.5"/><circle cx="6" cy="8.5" r="1"/><path d="M10 8.5 h7 M2 15 h18" stroke-dasharray="2 2"/>';
  } else if (/poe/.test(m)) {
    g = '<circle cx="11" cy="9" r="4.5"/><circle cx="11" cy="9" r="1.4"/><path d="M4 4 a10 10 0 0 1 14 0 M6.5 6.5 a6.5 6.5 0 0 1 9 0"/>';
  } else {
    g = '<rect x="5" y="4" width="12" height="9" rx="4"/><circle cx="11" cy="8.5" r="1.4"/>';
  }
  return `<svg width="17" height="13" viewBox="0 0 22 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px">${g}</svg>`;
}

function fmtBytes(b) {
  b = Number(b);
  if (isNaN(b)) return "—";
  if (b >= 1e12) return (b / 1e12).toFixed(2) + " TB";
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(0) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}
function fmtDur(days) {
  if (days == null) return "—";
  if (days >= 1) return days.toFixed(1) + " days";
  const h = days * 24;
  if (h >= 1) return h.toFixed(1) + " h";
  return Math.round(h * 60) + " min";
}

class NetworkLedgerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = "";
    this._nodes = null;
    this._hist = null;
    this._histAt = 0;
    this._histBusy = false;
  }

  static getStubConfig() {
    return { prefix: "robbins_dr", isp_name: "ISP", wan_monitor: "cox_first_hop" };
  }

  setConfig(config) {
    if (!config.prefix) throw new Error("network-ledger-card: `prefix` (your eero network entity prefix, e.g. robbins_dr) is required");
    this._config = {
      title: "The Network Ledger",
      isp_name: "ISP",
      isp_logo: "",
      wan_monitor: "",
      latency: [],
      dependencies: [],
      profiles: [],
      history_days: 30,
      ...config,
    };
    this._sig = "";
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._nodes && !this._nodesBusy) this._discoverNodes();
    const now = Date.now();
    if (this._config.wan_monitor && !this._histBusy && now - this._histAt > 30 * 60000) this._fetchHistory();
    const c = this._config;
    const watch = [
      `sensor.${c.prefix}_status`, `sensor.${c.prefix}_download_speed`, `sensor.${c.prefix}_upload_speed`,
      `sensor.${c.prefix}_data_usage_day`, `sensor.${c.prefix}_data_usage_month`,
      "binary_sensor.internet_backup_active", `switch.${c.prefix}_backup_internet_enabled`, "sensor.eero_uptime",
    ];
    for (const l of [...c.latency, ...c.dependencies]) watch.push(`sensor.${l.monitor}_response_time`, `sensor.${l.monitor}_status`);
    for (const p of c.profiles) watch.push(p.entity);
    if (this._nodes) for (const n of this._nodes) watch.push(n.clients, n.status);
    const sig = watch.map((id) => { const s = hass.states[id]; return s ? s.state : "?"; }).join("|") + "|" + (this._hist ? this._hist.key : "");
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }

  async _discoverNodes() {
    this._nodesBusy = true;
    try {
      const [er, dr] = await Promise.all([
        this._hass.callWS({ type: "config/entity_registry/list" }),
        this._hass.callWS({ type: "config/device_registry/list" }),
      ]);
      const nodes = [];
      for (const e of er) {
        if (e.platform !== "eero" || !/_connected_clients$/.test(e.entity_id) || /guest/.test(e.entity_id)) continue;
        const statusId = e.entity_id.replace(/_connected_clients$/, "_status");
        if (!er.some((x) => x.entity_id === statusId)) continue;
        const d = dr.find((x) => x.id === e.device_id);
        const model = d?.model || "";
        if (!/eero/i.test(model)) continue;
        nodes.push({ clients: e.entity_id, status: statusId, name: d?.name_by_user || d?.name || e.entity_id, model });
      }
      nodes.sort((a, b) => (this._hass.states[b.clients]?.state || 0) - (this._hass.states[a.clients]?.state || 0));
      this._nodes = nodes;
      this._sig = "";
      if (this._hass) this.hass = this._hass;
    } catch (e) { this._nodes = []; }
  }

  async _fetchHistory() {
    this._histBusy = true;
    try {
      const ent = `sensor.${this._config.wan_monitor}_status`;
      const start = new Date(Date.now() - this._config.history_days * 86400000).toISOString();
      const res = await this._hass.callWS({
        type: "history/history_during_period", start_time: start, end_time: new Date().toISOString(),
        entity_ids: [ent], minimal_response: true, no_attributes: true,
      });
      const raw = (res && res[ent]) || [];
      const pts = raw.map((p) => ({ state: p.s ?? p.state, t: (p.lu ?? p.last_updated) * 1000 })).filter((p) => p.t);
      if (!pts.length) { this._hist = { key: "none" }; return; }
      const now = Date.now();
      const first = pts[0].t;
      let downMs = 0, lastDownEnd = null, incidents = 0;
      for (let i = 0; i < pts.length; i++) {
        const st = pts[i].state;
        const t0 = pts[i].t;
        const t1 = i + 1 < pts.length ? pts[i + 1].t : now;
        if (st !== "up" && st !== "unavailable" && st !== "unknown") { downMs += t1 - t0; incidents++; lastDownEnd = t1; }
      }
      const spanMs = now - first;
      const windowDays = spanMs / 86400000;
      const uptimePct = spanMs > 0 ? (1 - downMs / spanMs) * 100 : null;
      const sinceDays = lastDownEnd ? (now - lastDownEnd) / 86400000 : null;
      this._hist = {
        key: `${Math.round(uptimePct * 100)}|${incidents}`,
        uptimePct, downMin: downMs / 60000, windowDays, incidents,
        sinceDays, noIncident: lastDownEnd == null,
      };
    } catch (e) { this._hist = { key: "err" }; }
    finally { this._histAt = Date.now(); this._histBusy = false; this._sig = ""; if (this._hass) this.hass = this._hass; }
  }

  _st(id) { return this._hass.states[id]; }
  _num(id) { const s = this._st(id); const v = parseFloat(s?.state); return isNaN(v) ? null : v; }

  _render() {
    const hass = this._hass, c = this._config;
    const net = this._st(`sensor.${c.prefix}_status`);
    if (!net) { this.shadowRoot.innerHTML = `<div style="padding:16px;background:${PAPER};color:${INK};border-radius:12px;font-family:sans-serif">Entity not found: sensor.${esc(c.prefix)}_status — check the card's prefix option.</div>`; return; }
    const connected = net.state === "connected";
    const down = this._num(`sensor.${c.prefix}_download_speed`);
    const up = this._num(`sensor.${c.prefix}_upload_speed`);
    const usageDay = this._st(`sensor.${c.prefix}_data_usage_day`);
    const usageMon = this._st(`sensor.${c.prefix}_data_usage_month`);
    const routerUp = this._num("sensor.eero_uptime");
    const backupSw = this._st(`switch.${c.prefix}_backup_internet_enabled`);
    const backupActive = this._st("binary_sensor.internet_backup_active");
    const nodes = this._nodes || [];
    let totalClients = 0;
    for (const n of nodes) totalClients += this._num(n.clients) || 0;
    const h = this._hist || {};
    const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase();

    /* lead figures */
    const uptimeStr = h.uptimePct != null ? (h.uptimePct >= 99.995 ? "100" : h.uptimePct.toFixed(2)) : "—";
    const windowStr = h.windowDays ? (h.windowDays >= 1 ? `${Math.round(h.windowDays)}D` : `${Math.max(1, Math.round(h.windowDays * 24))}H`) : "";
    const lostStr = h.uptimePct != null ? (h.downMin < 0.5 ? "0 min lost" : `${Math.round(h.downMin)} min lost`) : "awaiting history";
    const streakStr = h.noIncident && h.windowDays ? `${Math.floor(h.windowDays)}+` : h.sinceDays != null ? `${Math.floor(h.sinceDays)}` : "—";

    /* LTE chip: only when this network HAS backup internet */
    let lteChip = "";
    if (backupSw) {
      const active = backupActive && backupActive.state === "on";
      lteChip = `<span style="width:1px;height:24px;background:rgba(243,231,211,.3)"></span>
        <span class="chip" data-ent="${backupActive ? "binary_sensor.internet_backup_active" : `switch.${c.prefix}_backup_internet_enabled`}" style="font-size:calc(11*var(--px));font-weight:700;letter-spacing:1px;color:${active ? "#e88b6a" : "#d9a441"}">LTE · ${active ? "CARRYING THE HOUSE" : "STANDBY"}</span>`;
    }

    /* register rows */
    const lat = c.latency.map((l) => {
      const v = this._num(`sensor.${l.monitor}_response_time`);
      const okS = this._st(`sensor.${l.monitor}_status`);
      const bad = okS && okS.state !== "up";
      return { label: l.label, v, bad, ent: `sensor.${l.monitor}_response_time` };
    });
    const profs = c.profiles.map((p) => {
      const s = this._st(p.entity);
      return { name: p.name, known: !!s, paused: s?.state === "on", ent: p.entity };
    });
    const deps = c.dependencies.map((d) => {
      const v = this._num(`sensor.${d.monitor}_response_time`);
      const okS = this._st(`sensor.${d.monitor}_status`);
      const bad = okS && okS.state !== "up";
      return { label: d.label, v, bad, ent: `sensor.${d.monitor}_response_time` };
    });

    const row = (k, v, ent, vStyle) => `<div class="row"${ent ? ` data-ent="${esc(ent)}"` : ""}><span class="k">${k}</span><span class="v"${vStyle ? ` style="${vStyle}"` : ""}>${v}</span></div>`;

    let regRows = "";
    if (usageDay) regRows += row("Drawn today", fmtBytes(usageDay.state), usageDay.entity_id);
    if (usageMon) regRows += row("Month to date", fmtBytes(usageMon.state), usageMon.entity_id);
    regRows += row("Devices", String(totalClients), nodes[0]?.clients);
    for (const l of lat.slice(0, 2)) regRows += row(esc(l.label), l.bad ? "✖ down" : `${r0(l.v)} ms`, l.ent, l.bad ? `color:${TERRA}` : "");
    for (const p of profs) regRows += row(`${esc(p.name)}'s wire`, p.known ? (p.paused ? "✖ paused" : "✓ active") : "—", p.ent, p.paused ? `color:${TERRA}` : `color:${GREEN}`);

    let meshRows = "";
    for (const n of nodes) {
      const st = this._st(n.status);
      const cl = this._num(n.clients);
      const good = st?.state === "green";
      meshRows += row(`<span style="color:${INK}">${nodeGlyph(n.model)}</span>${esc(n.name)}`, `<span style="color:${good ? GREEN : TERRA}">●</span> ${r0(cl)}`, n.status);
    }
    if (routerUp != null) meshRows += row("Router up", fmtDur(routerUp / 86400), "sensor.eero_uptime");

    const depStrip = deps.map((d) => `<span class="dep" data-ent="${esc(d.ent)}" style="font-size:calc(11*var(--px));color:${BROWN}"><span style="color:${d.bad ? TERRA : GREEN}">${d.bad ? "✖" : "✓"}</span> ${esc(d.label)} <b class="serif" style="font-size:calc(12*var(--px));color:${d.bad ? TERRA : INK}">${d.bad ? "down" : r0(d.v) + " ms"}</b></span>`).join("");

    const brand = c.isp_logo
      ? `<img src="${esc(c.isp_logo)}" style="height:calc(30*var(--px));max-width:calc(110*var(--px));object-fit:contain">`
      : `<span class="serif" style="font-size:calc(22*var(--px));font-weight:900;letter-spacing:2px">${esc(c.isp_name).toUpperCase()}</span>`;

    this.shadowRoot.innerHTML = `
<style>
  :host { display: block; }
  * { box-sizing: border-box; }
  .wrap { container-type: inline-size; }
  .card { --px: max(0.5px, 0.1923cqw); background: ${PAPER}; color: ${INK};
    border-radius: var(--ha-card-border-radius, 14px); box-shadow: var(--ha-card-box-shadow, 0 4px 16px rgba(0,0,0,.18));
    overflow: hidden; font-family: Archivo, 'Segoe UI', sans-serif; padding: calc(22*var(--px)) calc(32*var(--px)); }
  .serif { font-family: Fraunces, Georgia, serif; }
  .sect { font-size: max(8px, calc(10*var(--px))); font-weight: 700; letter-spacing: calc(3*var(--px)); color: ${TAN}; border-bottom: 1.5px solid ${INK}; padding-bottom: calc(5*var(--px)); }
  .row { display: flex; justify-content: space-between; align-items: center; padding: calc(6*var(--px)) 0; border-bottom: 1px dotted ${DOT}; cursor: pointer; }
  .row:last-child { border-bottom: none; }
  .k { font-size: max(9px, calc(12*var(--px))); color: ${BROWN}; display: flex; align-items: center; }
  .v { font-family: Fraunces, Georgia, serif; font-size: max(10px, calc(13.5*var(--px))); font-weight: 600; }
  .dep { cursor: pointer; }
  @container (max-width: 380px) { .cols { grid-template-columns: 1fr !important; } .coldiv { display: none; } }
</style>
<div class="wrap"><div class="card">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <span data-ent="sensor.${esc(c.prefix)}_status" style="cursor:pointer">${brand}</span>
    <div style="text-align:center">
      <div class="serif" style="font-size:calc(24*var(--px));font-weight:700">${esc(c.title)}</div>
      <div style="font-size:max(7px,calc(9*var(--px)));font-weight:700;letter-spacing:calc(3*var(--px));color:${TAN};margin-top:calc(2*var(--px))">${date}</div>
    </div>
    <img src="https://brands.home-assistant.io/_/eero/logo.png" style="height:calc(22*var(--px));max-width:calc(80*var(--px));object-fit:contain;opacity:.85">
  </div>
  <div style="width:100%;height:2px;background:${INK};margin-top:calc(10*var(--px))"></div>
  <div style="display:flex;justify-content:space-around;align-items:center;margin-top:calc(14*var(--px))">
    <div style="text-align:center;cursor:pointer" data-ent="sensor.${esc(c.wan_monitor)}_status">
      <div class="serif" style="font-size:calc(56*var(--px));font-weight:900;line-height:1">${uptimeStr}<span style="font-size:calc(24*var(--px))">%</span></div>
      <div style="font-size:max(7px,calc(9.5*var(--px)));font-weight:700;letter-spacing:calc(1.5*var(--px));color:${BROWN};margin-top:calc(4*var(--px))">UPTIME ${windowStr} · ${esc(lostStr).toUpperCase()}</div>
    </div>
    <div style="width:1px;height:calc(62*var(--px));background:${DOT}"></div>
    <div style="text-align:center;cursor:pointer" data-ent="sensor.${esc(c.wan_monitor)}_status">
      <div class="serif" style="font-size:calc(56*var(--px));font-weight:900;line-height:1">${streakStr}</div>
      <div style="font-size:max(7px,calc(9.5*var(--px)));font-weight:700;letter-spacing:calc(1.5*var(--px));color:${BROWN};margin-top:calc(4*var(--px))">DAYS SINCE LAST INCIDENT</div>
    </div>
  </div>
  <div style="background:${connected ? INK : TERRA};color:${PAPER};border-radius:calc(10*var(--px));display:flex;justify-content:space-around;align-items:center;padding:calc(9*var(--px)) 0;margin-top:calc(14*var(--px))">
    ${connected ? `
    <span class="serif" data-ent="sensor.${esc(c.prefix)}_download_speed" style="cursor:pointer;font-size:calc(22*var(--px));font-weight:900">↓ ${down != null ? down.toLocaleString(undefined, {maximumFractionDigits: 0}) : "—"} <span style="font-size:calc(11*var(--px));font-weight:600;opacity:.7">Mbps</span></span>
    <span style="width:1px;height:calc(24*var(--px));background:rgba(243,231,211,.3)"></span>
    <span class="serif" data-ent="sensor.${esc(c.prefix)}_upload_speed" style="cursor:pointer;font-size:calc(22*var(--px));font-weight:900">↑ ${up != null ? up.toLocaleString(undefined, {maximumFractionDigits: 0}) : "—"} <span style="font-size:calc(11*var(--px));font-weight:600;opacity:.7">Mbps</span></span>
    ${lteChip}` : `<span class="serif" style="font-size:calc(18*var(--px));font-weight:900;letter-spacing:2px">✖ THE WIRE IS DOWN${backupActive?.state === "on" ? " — LTE CARRYING THE HOUSE" : ""}</span>`}
  </div>
  <div class="cols" style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0 calc(18*var(--px));margin-top:calc(14*var(--px))">
    <div>
      <div class="sect">THE REGISTER</div>
      ${regRows}
    </div>
    <div class="coldiv" style="background:${DOT}"></div>
    <div>
      <div class="sect">THE MESH</div>
      ${meshRows || `<div class="row"><span class="k">discovering…</span></div>`}
    </div>
  </div>
  ${deps.length ? `
  <div style="margin-top:calc(12*var(--px))">
    <div class="sect">DISTANT DEPENDENCIES <span style="float:right;letter-spacing:calc(1*var(--px))">NOT THE WIRE'S FAULT</span></div>
    <div style="display:flex;justify-content:space-between;padding-top:calc(8*var(--px))">${depStrip}</div>
  </div>` : ""}
</div></div>`;

    this.shadowRoot.querySelectorAll("[data-ent]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const t = ev.target.closest("[data-ent]");
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: t.dataset.ent }, bubbles: true, composed: true }));
      });
    });
  }

  getCardSize() { return 7; }
}

if (!document.getElementById("nlc-font")) {
  const l = document.createElement("link");
  l.id = "nlc-font"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,900&family=Archivo:wght@500;600;700&display=swap";
  document.head.appendChild(l);
}

customElements.define("network-ledger-card", NetworkLedgerCard);
console.info(`%c NETWORK-LEDGER-CARD %c ${NLC_VERSION} `, "background:#3a2d1f;color:#f3e7d3;font-weight:700", "background:#c65f38;color:#fff;font-weight:700");
window.customCards = window.customCards || [];
window.customCards.push({
  type: "network-ledger-card",
  name: "Network Ledger Card",
  description: "Editorial almanac-style internet health panel: ISP uptime and incident streak from Uptime Kuma history, eero mesh with per-model glyphs, latency post, cloud-dependency strip.",
  preview: true,
  documentationURL: "https://github.com/LoneWolf345/network-ledger-card",
});
