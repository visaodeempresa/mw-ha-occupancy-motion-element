/* mw-ha-occupancy-motion-element — custom:mw-occupancy-motion-element
 * Elemento de picture-elements: o sensor de movimento / presença na planta.
 *
 * v1.0 — mesma reescrita do mw-light-element, e pelos mesmos motivos:
 *  · DOM montado UMA vez; atualizar = trocar atributo + custom properties
 *    (zero innerHTML, zero re-parse de CSS, zero <ha-icon> recriado);
 *  · folha de estilo única compartilhada por TODAS as instâncias
 *    (adoptedStyleSheets) — 12 sensores na planta = 1 CSS parseado;
 *  · o `set hass` compara a referência do state object e sai em O(1) quando
 *    a mudança é de outra entidade (o HA empurra `hass` a cada mudança de
 *    QUALQUER entidade — é aqui que uma planta cheia engasga);
 *  · animações só em `transform`/`opacity` (composição na GPU) e, por padrão,
 *    só no estado detectado: casa parada não gasta um frame;
 *  · geometria em % + aspect-ratio + unidades de container: o sensor mantém a
 *    proporção da planta em qualquer tamanho de tela;
 *  · editor visual (`getConfigElement`) — formulário em vez de YAML cru.
 *
 * JS puro, arquivo único, sem build.
 * Repo: https://github.com/visaodeempresa/mw-ha-occupancy-motion-element
 */
(() => {
  "use strict";

  const VERSION = "1.0.1";

  const DEFAULTS = {
    // --- entidade ---
    entity: "",
    name: "",                   // tooltip; vazio = friendly_name
    invert: false,              // entidade invertida (on = livre)
    show_age: true,             // tooltip ganha "· detectado há 3 min"

    // --- geometria (% = acompanha a planta ao redimensionar) ---
    left: "",
    top: "",
    size: "6%",                 // lado da caixa em % da largura da planta
    scale: null,                // multiplicador opcional do conjunto
    rotate: null,

    // --- aparência ---
    effect: "glow",             // glow · neon · soft · flat
    glow: true,
    glow_when: "detected",      // detected · always · never
    glow_blur: "18%",           // % = do lado do elemento (vira cqmin)
    glow_opacity: 0.7,
    glow_color_detected: "", glow_color_clear: "",
    glow_color_unavailable: "", glow_color_unknown: "",

    // --- cores por estado ---
    color_detected: "var(--mw-presence-color, #ffa726)",
    color_clear: "rgba(176, 190, 197, 0.55)",
    color_unavailable: "rgba(255, 99, 71, 0.85)",
    color_unknown: "rgba(255, 99, 71, 0.85)",

    // --- placa (a superfície que recebe a elevação) ---
    plate: "none",              // none · circle · rounded · square
    plate_radius: "26%",
    plate_opacity: 0.16,        // alfa da placa derivada da cor do estado
    plate_color_detected: "", plate_color_clear: "",
    plate_color_unavailable: "", plate_color_unknown: "",
    plate_frost: 0,             // px de backdrop-filter (vidro fosco) — CARO
    ring: 0,                    // espessura da borda da placa ("6%" ou "2px")
    ring_opacity: 0.55,
    ring_color_detected: "", ring_color_clear: "",
    ring_color_unavailable: "", ring_color_unknown: "",

    // --- elevação / sombra ---
    elevation: 0,               // 0–5 (placa: box-shadow · sem placa: drop-shadow)
    elevation_detected: null,   // degrau só quando detecta
    shadow: "",                 // CSS cru de box-shadow (vence a elevação)
    icon_shadow: "",            // CSS cru de filter (vence a elevação, sem placa)
    shadow_color: "",           // tinge as sombras prontas preservando os alfas

    // --- animação (transform/opacity apenas) ---
    animation: "radar",         // none · pulse · radar · beacon · blink
    animation_when: "detected", // detected · always · never
    animation_speed: 2.4,       // segundos por ciclo
    rings: 2,                   // anéis do radar (1 ou 2)
    radar_width: "4%",          // espessura do anel ("4%" ou "2px")
    ring_spread: 1.75,          // até onde o anel cresce
    reduced_motion: true,       // respeita prefers-reduced-motion

    // --- esfriamento: a cor esvai em vez de estalar ---
    fade: 0.7,

    // --- ícones ---
    icon: "",                   // força o ícone em todos os estados
    icon_set: "",               // auto · motion · occupancy · presence · moving
    icon_detected: "",
    icon_clear: "",
    icon_unavailable: "mdi:cancel",
    icon_unknown: "mdi:crosshairs-question",
    icon_fallback: "mdi:motion-sensor",
    icon_size: "",              // vazio = 60% do lado (acompanha a planta)
    icon_scale: 1,
    icon_offset_y: "0",
    icon_upright: false,        // desfaz o `rotate` só no ícone
    icon_opacity_detected: 1,
    icon_opacity_clear: 0.75,
    icon_opacity_unavailable: 0.9,
    icon_opacity_unknown: 0.9,

    // --- visibilidade por estado ---
    hide_detected: false,
    hide_clear: false,
    hide_unavailable: false,
    hide_unknown: false,

    // --- ações ---
    tap_action: "more-info",
    hold_action: "more-info",
    double_tap_action: "none",
    lock_when_broken: false,    // true = indisponível/desconhecido não aceita tap
    haptic: true,
    navigation_path: "",
    url_path: "",
    service: "",
    service_data: null,
  };

  // multiplicadores de halo/animação por efeito
  const EFFECTS = {
    glow: { blur: 1, op: 1 },
    neon: { blur: 1.7, op: 1.25 },
    soft: { blur: 0.65, op: 0.8 },
    flat: { blur: 0, op: 0 },
  };

  const DETECTED = new Set(["on", "detected", "home", "open", "active", "motion", "occupied"]);
  const CLEAR = new Set(["off", "clear", "not_home", "closed", "idle", "standby", "away"]);

  // pares [detectado, livre] — `icon_set` só entra se o dono pedir
  const ICON_SETS = {
    motion: ["mdi:motion-sensor", "mdi:motion-sensor-off"],
    occupancy: ["mdi:home-account", "mdi:home-outline"],
    presence: ["mdi:account", "mdi:account-outline"],
    moving: ["mdi:run", "mdi:human-handsdown"],
  };
  const DEVICE_CLASS_SET = {
    motion: "motion", occupancy: "occupancy", presence: "presence", moving: "moving",
  };

  // sombras em cqmin: a elevação acompanha a planta, não o zoom do navegador
  const NO_SHADOW = "0 0 0 0 rgba(0,0,0,0)";
  const ELEV_BOX = [
    NO_SHADOW,
    "0 1.5cqmin 3cqmin rgba(0,0,0,0.30), 0 0.5cqmin 1.5cqmin rgba(0,0,0,0.18)",
    "0 3cqmin 6cqmin rgba(0,0,0,0.30), 0 1cqmin 2.5cqmin rgba(0,0,0,0.20)",
    "0 5cqmin 10cqmin rgba(0,0,0,0.32), 0 2cqmin 4cqmin rgba(0,0,0,0.22)",
    "0 8cqmin 16cqmin rgba(0,0,0,0.34), 0 3cqmin 7cqmin rgba(0,0,0,0.24)",
    "0 12cqmin 24cqmin rgba(0,0,0,0.36), 0 5cqmin 11cqmin rgba(0,0,0,0.26)",
  ];
  const ELEV_ICON = [
    "",
    "drop-shadow(0 1.5cqmin 1.5cqmin rgba(0,0,0,0.35))",
    "drop-shadow(0 3cqmin 3cqmin rgba(0,0,0,0.38))",
    "drop-shadow(0 5cqmin 5cqmin rgba(0,0,0,0.40))",
    "drop-shadow(0 8cqmin 8cqmin rgba(0,0,0,0.42))",
    "drop-shadow(0 12cqmin 12cqmin rgba(0,0,0,0.45))",
  ];

  /* ---------------------------------------------------------------- estilo
   * Uma folha só para todas as instâncias: o que varia por sensor vive em
   * custom properties, o que varia por estado vive em atributos do host.
   */
  const CSS = `
:host{position:absolute;display:block;box-sizing:border-box;
  width:var(--mw-size,6%);aspect-ratio:1;container-type:size;contain:layout style;
  cursor:var(--mw-cursor,pointer);touch-action:manipulation;
  -webkit-tap-highlight-color:transparent;user-select:none;}
:host([mw-hidden]){display:none;}
.aura,.rings,.rings i,.press,.plate,.box{position:absolute;pointer-events:none;}
.aura{left:50%;top:50%;width:100cqmin;height:100cqmin;border-radius:50%;display:none;
  background:radial-gradient(circle closest-side,var(--mw-glow,transparent) 0%,transparent 70%);
  transform:translate3d(-50%,-50%,0) scale(1);}
.rings{inset:0;display:none;}
.rings i{inset:0;border-radius:50%;opacity:0;
  box-shadow:inset 0 0 0 var(--mw-ring-w,4cqmin) var(--mw-c,transparent);
  transform:translate3d(0,0,0) scale(.35);}
.rings i:nth-child(2){display:var(--mw-ring2,block);
  animation-delay:calc(var(--mw-spd,2.4s) / -2);}
.press{inset:0;transform:scale(1);transition:transform .12s ease;}
:host(:active) .press{transform:scale(.92);}
.plate{inset:0;display:var(--mw-plate-display,none);border-radius:var(--mw-radius,50%);
  background:var(--mw-plate,transparent);
  box-shadow:var(--mw-elev,${NO_SHADOW}),var(--mw-ring,${NO_SHADOW});
  backdrop-filter:var(--mw-frost,none);-webkit-backdrop-filter:var(--mw-frost,none);
  transition:background var(--mw-fade,.7s) ease,box-shadow var(--mw-fade,.7s) ease;}
.box{inset:0;display:flex;align-items:center;justify-content:center;
  transform:translateY(var(--mw-icon-dy,0)) var(--mw-icon-rot,rotate(0deg));}
.ico{--mdc-icon-size:var(--mw-icon-size,60cqmin);color:var(--mw-c,#fff);
  opacity:var(--mw-icon-op,1);filter:var(--mw-ico-filter,none);
  transform:scale(var(--mw-icon-scale,1));
  transition:color var(--mw-fade,.7s) ease,opacity var(--mw-fade,.7s) ease,
    filter var(--mw-fade,.7s) ease;}

@keyframes mw-pulse{
  0%,100%{transform:scale(var(--mw-icon-scale,1));}
  50%{transform:scale(calc(var(--mw-icon-scale,1) * 1.14));}}
@keyframes mw-blink{
  0%,14%,28%,100%{opacity:var(--mw-icon-op,1);}
  7%,21%{opacity:.15;}}
@keyframes mw-breathe{
  0%,100%{opacity:.3;transform:translate3d(-50%,-50%,0) scale(.88);}
  50%{opacity:.85;transform:translate3d(-50%,-50%,0) scale(1.14);}}
@keyframes mw-ring{
  0%{transform:translate3d(0,0,0) scale(.35);opacity:.6;}
  70%{opacity:.12;}
  100%{transform:translate3d(0,0,0) scale(var(--mw-spread,1.75));opacity:0;}}

:host([anim="pulse"]) .ico{animation:mw-pulse var(--mw-spd,2.4s) ease-in-out infinite;
  will-change:transform;}
:host([anim="blink"]) .ico{animation:mw-blink var(--mw-spd,2.4s) steps(1,end) infinite;
  will-change:opacity;}
:host([anim="beacon"]) .aura{display:block;
  animation:mw-breathe var(--mw-spd,2.4s) ease-in-out infinite;
  will-change:transform,opacity;}
:host([anim="radar"]) .rings{display:block;}
:host([anim="radar"]) .rings i{animation:mw-ring var(--mw-spd,2.4s) ease-out infinite;
  will-change:transform,opacity;}

/* quem pediu menos movimento no sistema não recebe animação — a não ser que
   o YAML diga reduced_motion: false (aí o host carrega [mw-motion]) */
@media (prefers-reduced-motion:reduce){
  :host(:not([mw-motion])) .ico,
  :host(:not([mw-motion])) .aura,
  :host(:not([mw-motion])) .rings i{animation:none;}
  :host(:not([mw-motion])) .ico,
  :host(:not([mw-motion])) .plate,
  :host(:not([mw-motion])) .press{transition:none;}}`;

  let SHEET;
  const sharedSheet = () => {
    if (SHEET !== undefined) return SHEET;
    try {
      const s = new CSSStyleSheet();
      s.replaceSync(CSS);
      SHEET = s;
    } catch (e) { SHEET = null; }
    return SHEET;
  };

  const num = (v, d) => (v === null || v === undefined || v === "" || isNaN(Number(v))
    ? d : Number(v));

  // "6%" → "6cqmin" (% do lado do próprio elemento; `border`/`blur` em % não
  // existem no CSS, mas cqmin resolve e ainda acompanha a planta)
  const len = (v, fallback) => {
    const s = String(v === null || v === undefined ? "" : v).trim();
    if (!s) return fallback;
    if (/^-?[\d.]+$/.test(s)) return `${s}px`;
    return /%$/.test(s) ? `${parseFloat(s)}cqmin` : s;
  };

  // "12cqmin" × 1.7 → "20.4cqmin" (mantém a unidade)
  const scaleLen = (v, f) => {
    const m = String(v).match(/^(-?[\d.]+)([a-z%]*)$/i);
    if (!m) return String(v);
    return `${Math.round(parseFloat(m[1]) * f * 100) / 100}${m[2] || "px"}`;
  };

  const rgbOf = (c) => {
    let m = String(c).match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const p = m[1].split(",").map((s) => s.trim());
      if (p.length >= 3) return [p[0], p[1], p[2]];
    }
    m = String(c).match(/^#([0-9a-fA-F]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return null;
  };

  // mesma cor, outro alfa. rgb/rgba/#hex saem em rgba(); `var(--x)` e nome de
  // cor caem no color-mix (Chrome 111+/Safari 16.2+, folgado para o HA 2024.4)
  const withAlpha = (color, alpha) => {
    const c = String(color || "").trim();
    if (!c) return c;
    const p = rgbOf(c);
    if (p) return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${alpha})`;
    return `color-mix(in srgb, ${c} ${Math.round(alpha * 100)}%, transparent)`;
  };

  // troca o preto das sombras prontas pela cor pedida, preservando os alfas
  const tint = (shadow, color) => {
    const p = color && rgbOf(color);
    return p ? String(shadow).replace(/rgba\(0,0,0,/g, `rgba(${p[0]},${p[1]},${p[2]},`) : shadow;
  };

  const ago = (iso) => {
    const t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return `há ${s}s`;
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    return `há ${Math.round(s / 86400)} d`;
  };

  const MODE_LABEL = {
    detected: "detectado", clear: "livre",
    unavailable: "indisponível", unknown: "desconhecido",
  };

  const resolveMode = (raw, invert) => {
    if (raw === undefined || raw === null || raw === "unavailable") return "unavailable";
    if (raw === "unknown" || raw === "") return "unknown";
    const r = String(raw).toLowerCase();
    let on = DETECTED.has(r) ? true : CLEAR.has(r) ? false : null;
    if (on === null) return "unknown";
    if (invert) on = !on;
    return on ? "detected" : "clear";
  };

  const fire = (node, type, detail) => {
    node.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  };

  class MwOccupancyMotionElement extends HTMLElement {
    static getStubConfig() {
      return {
        type: "custom:mw-occupancy-motion-element",
        entity: "", left: "50%", top: "50%", size: "6%",
      };
    }

    static getConfigElement() {
      return document.createElement("mw-occupancy-motion-element-editor");
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._props = {};
      this._mode = null;
      this._built = false;
      this._bindPointer();
      // o "há 3 min" do tooltip é relativo ao relógio: em vez de um timer por
      // sensor, atualiza no instante em que o mouse chega
      this.addEventListener("pointerenter", () => this._title());
    }

    // ponteiro único: nada de `click` (evita o clique-fantasma e o tap comido
    // depois de um hold)
    _bindPointer() {
      let t0 = 0, x0 = 0, y0 = 0, held = false, timer = null, tapTimer = null, taps = 0;
      const clear = () => { clearTimeout(timer); timer = null; };

      this.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        held = false; t0 = e.timeStamp; x0 = e.clientX; y0 = e.clientY;
        clear();
        timer = setTimeout(() => {
          held = true;
          this._haptic("medium");
          this._run(this._cfg && this._cfg.hold_action, false);
        }, 480);
      });

      const end = (e) => {
        clear();
        if (held) { held = false; return; }
        const moved = Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 12;
        if (moved || e.timeStamp - t0 > 900) return;
        e.stopPropagation();
        const dbl = this._cfg && this._cfg.double_tap_action;
        const hasDbl = String(typeof dbl === "string" ? dbl : (dbl || {}).action) !== "none";
        if (!hasDbl) { this._tap(); return; }
        taps += 1;
        if (taps === 1) {
          tapTimer = setTimeout(() => { taps = 0; this._tap(); }, 230);
        } else {
          clearTimeout(tapTimer); taps = 0;
          this._run(dbl, true);
        }
      };
      this.addEventListener("pointerup", end);
      this.addEventListener("pointercancel", () => { clear(); held = false; });
      this.addEventListener("pointerleave", () => { clear(); });
      this.addEventListener("click", (e) => e.stopPropagation());
    }

    _tap() {
      this._haptic("light");
      this._run(this._cfg && this._cfg.tap_action, true);
    }

    _haptic(kind) {
      if (this._cfg && this._cfg.haptic) fire(this, "haptic", kind);
    }

    setConfig(config) {
      if (!config || !config.entity) {
        throw new Error("mw-occupancy-motion-element: informe 'entity'");
      }
      this._cfg = { ...DEFAULTS, ...config };
      this._fx = EFFECTS[this._cfg.effect] || EFFECTS.glow;
      this._mode = null;
      this._props = {};
      this._st = undefined;
      this._applyGeometry();
      this._update();
    }

    getCardSize() { return 1; }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._cfg) return;
      const st = hass && hass.states[this._cfg.entity];
      // caminho rápido: o HA empurra `hass` a cada mudança de qualquer
      // entidade; se o state object é o mesmo, não há nada a fazer
      if (!first && st === this._st) return;
      this._st = st;
      this._update();
    }

    get hass() { return this._hass; }

    connectedCallback() { if (this._cfg) this._update(); }

    // o picture-elements escreve o `style:` do YAML no host logo depois de
    // criar o elemento; o que vier na config vence, o que não vier não é tocado
    _applyGeometry() {
      const c = this._cfg;
      const set = (p, v) => {
        if (v === "" || v === null || v === undefined) return;
        this.style.setProperty(p, String(v));
      };
      set("left", c.left);
      set("top", c.top);
      set("--mw-size", c.size);
      set("--mw-radius", c.plate === "rounded" ? c.plate_radius
        : c.plate === "square" ? "0" : "50%");
      const hasR = c.rotate !== null && c.rotate !== "";
      const hasS = c.scale !== null && c.scale !== "";
      // o translate(-50%,-50%) é o que centra o elemento no ponto (left,top)
      const r = hasR ? ` rotate(${c.rotate}deg)` : "";
      const s = hasS ? ` scale(${c.scale})` : "";
      set("transform", `translate(-50%, -50%)${r}${s}`);
      if (hasR && c.icon_upright) set("--mw-icon-rot", `rotate(${-c.rotate}deg)`);

      // o que é fixo por sensor entra uma vez só, fora do caminho quente
      this._set("--mw-plate-display", c.plate === "none" ? "none" : "block");
      this._set("--mw-spd", `${num(c.animation_speed, 2.4)}s`);
      this._set("--mw-fade", `${num(c.fade, 0.7)}s`);
      this._set("--mw-spread", num(c.ring_spread, 1.75));
      this._set("--mw-ring-w", len(c.radar_width, "4cqmin"));
      this._set("--mw-ring2", num(c.rings, 2) > 1 ? "block" : "none");
      this._set("--mw-icon-scale", num(c.icon_scale, 1));
      this._set("--mw-icon-dy", c.icon_offset_y);
      if (c.icon_size) this._set("--mw-icon-size", len(c.icon_size));
      if (num(c.plate_frost, 0) > 0) {
        this._set("--mw-frost", `blur(${num(c.plate_frost, 0)}px)`);
      }
      if (!c.reduced_motion) this.setAttribute("mw-motion", "");
      else this.removeAttribute("mw-motion");
    }

    _build() {
      const root = this.shadowRoot;
      const sheet = sharedSheet();
      if (sheet && "adoptedStyleSheets" in root) root.adoptedStyleSheets = [sheet];
      else {
        const st = document.createElement("style");
        st.textContent = CSS;
        root.appendChild(st);
      }
      const mk = (parent, cls, tag) => {
        const n = document.createElement(tag || "div");
        if (cls) n.className = cls;
        parent.appendChild(n);
        return n;
      };
      this._aura = mk(root, "aura");
      const rings = mk(root, "rings");
      mk(rings, ""); mk(rings, "");
      this._press = mk(root, "press");
      this._plate = mk(this._press, "plate");
      this._box = mk(this._press, "box");
      this._ico = mk(this._box, "ico", "ha-icon");
      this._built = true;
    }

    // só escreve o que mudou — custom property que já vale não vira repaint
    _set(prop, val) {
      const v = val === null || val === undefined ? "" : String(val);
      if (this._props[prop] === v) return;
      this._props[prop] = v;
      if (v === "") this.style.removeProperty(prop);
      else this.style.setProperty(prop, v);
    }

    _title() {
      const c = this._cfg;
      if (!c) return;
      const st = this._st;
      const attrs = (st && st.attributes) || {};
      const age = c.show_age && st ? ago(st.last_changed) : "";
      const base = c.name || attrs.friendly_name || c.entity;
      const t = `${base} · ${MODE_LABEL[this._mode] || ""}${age ? " " + age : ""}`;
      if (this.title !== t) this.title = t;
    }

    _update() {
      const c = this._cfg;
      const hass = this._hass;
      if (!c || !hass) return;
      if (!this._built) this._build();

      const st = hass.states[c.entity];
      this._st = st;
      const attrs = (st && st.attributes) || {};
      const mode = resolveMode(st && st.state, c.invert);
      this._mode = mode;
      if (mode !== this.getAttribute("mode")) this.setAttribute("mode", mode);

      if (c[`hide_${mode}`]) this.setAttribute("mw-hidden", "");
      else this.removeAttribute("mw-hidden");

      const color = c[`color_${mode}`];
      this._set("--mw-c", color);
      this._set("--mw-icon-op", c[`icon_opacity_${mode}`]);

      // halo: drop-shadow no ícone (segue o desenho, não a caixa) e, no modo
      // beacon, a auréola radial por trás
      const glowOn = c.glow && this._fx.blur > 0 && c.glow_when !== "never"
        && (c.glow_when === "always" || mode === "detected");
      const glowColor = c[`glow_color_${mode}`]
        || withAlpha(color, Math.min(1, c.glow_opacity * this._fx.op));
      // a auréola do `beacon` só aparece nesse modo, então a cor pode ficar
      // sempre escrita; quem liga/desliga o halo é o filtro do ícone
      this._set("--mw-glow", glowColor);

      this._set("--mw-plate", c.plate === "none" ? "transparent"
        : (c[`plate_color_${mode}`] || withAlpha(color, c.plate_opacity)));
      const ringW = len(c.ring, "0px");
      this._set("--mw-ring", parseFloat(ringW)
        ? `inset 0 0 0 ${ringW} ${c[`ring_color_${mode}`] || withAlpha(color, c.ring_opacity)}`
        : NO_SHADOW);

      // elevação: na placa vira box-shadow; sem placa, drop-shadow no ícone
      const lvlRaw = mode === "detected" && c.elevation_detected !== null
        && c.elevation_detected !== "" ? c.elevation_detected : c.elevation;
      const lvl = Math.max(0, Math.min(5, Math.round(num(lvlRaw, 0))));
      const hasPlate = c.plate !== "none";
      this._set("--mw-elev", hasPlate
        ? (c.shadow || tint(ELEV_BOX[lvl], c.shadow_color)) : NO_SHADOW);

      const filters = [];
      if (glowOn) {
        filters.push(`drop-shadow(0 0 ${
          scaleLen(len(c.glow_blur, "18cqmin"), this._fx.blur)} ${glowColor})`);
      }
      if (c.icon_shadow) filters.push(c.icon_shadow);
      else if (!hasPlate && ELEV_ICON[lvl]) filters.push(tint(ELEV_ICON[lvl], c.shadow_color));
      this._set("--mw-ico-filter", filters.length ? filters.join(" ") : "none");

      // ícone: `icon` manda em tudo; senão o par do `icon_set`/device_class;
      // senão o ícone da própria entidade; livre herda o do detectado
      const pair = c.icon_set === "auto"
        ? ICON_SETS[DEVICE_CLASS_SET[attrs.device_class]] : ICON_SETS[c.icon_set];
      const fromSet = pair ? (mode === "detected" ? pair[0] : pair[1]) : "";
      const icon = c.icon
        || (mode === "detected" || mode === "clear"
          ? (fromSet || c[`icon_${mode}`] || c.icon_detected || attrs.icon || c.icon_fallback)
          : c[`icon_${mode}`]);
      if (icon !== this._icon) {
        this._icon = icon;
        this._ico.setAttribute("icon", icon);
      }

      const anim = c.animation && c.animation !== "none" && c.animation_when !== "never"
        && (c.animation_when === "always" || mode === "detected") ? c.animation : "";
      if (anim !== this.getAttribute("anim")) {
        if (anim) this.setAttribute("anim", anim);
        else this.removeAttribute("anim");
      }

      const tap = typeof c.tap_action === "string" ? c.tap_action : (c.tap_action || {}).action;
      const locked = c.lock_when_broken && (mode === "unavailable" || mode === "unknown");
      this._set("--mw-cursor", String(tap) !== "none" && !locked ? "pointer" : "default");

      this._title();
    }

    _run(spec, guarded) {
      const c = this._cfg;
      if (!c || !this._hass) return;
      if (guarded && c.lock_when_broken
        && (this._mode === "unavailable" || this._mode === "unknown")) return;
      const a = typeof spec === "string" ? { action: spec } : (spec || { action: "none" });
      switch (a.action) {
        case "none":
          return;
        case "toggle":
          this._hass.callService("homeassistant", "toggle",
            { entity_id: a.entity_id || c.entity });
          return;
        case "call-service":
        case "perform-action": {
          const svc = a.perform_action || a.service || c.service;
          if (!svc || svc.indexOf(".") < 0) return;
          const [dom, srv] = svc.split(".");
          this._hass.callService(dom, srv,
            a.data || a.service_data || c.service_data || {}, a.target);
          return;
        }
        case "navigate": {
          const path = a.navigation_path || c.navigation_path;
          if (!path) return;
          history.pushState(null, "", path);
          fire(window, "location-changed", { replace: false });
          return;
        }
        case "url": {
          const url = a.url_path || c.url_path;
          if (url) window.open(url, a.new_tab === false ? "_self" : "_blank");
          return;
        }
        default:
          fire(this, "hass-more-info", { entityId: a.entity || c.entity });
      }
    }
  }

  /* ---------------------------------------------------------------- editor
   * O picture-elements procura `getConfigElement()` no elemento custom; com
   * isto, editar o sensor no editor visual do card mostra formulário em vez
   * de YAML cru. Onde a versão do HA não suportar, o YAML continua valendo.
   */
  const LABELS = {
    entity: "Entidade", name: "Nome (tooltip)", left: "Esquerda", top: "Topo",
    size: "Tamanho", scale: "Escala", rotate: "Rotação", effect: "Efeito",
    icon: "Ícone (força)", icon_set: "Jogo de ícones",
    animation: "Animação", animation_when: "Animar quando",
    animation_speed: "Ciclo da animação (s)", rings: "Anéis do radar",
    ring_spread: "Alcance do anel", reduced_motion: "Respeitar menos movimento",
    plate: "Placa", plate_radius: "Raio da placa", plate_opacity: "Opacidade da placa",
    plate_frost: "Vidro fosco (px)", ring: "Borda da placa",
    elevation: "Elevação", elevation_detected: "Elevação ao detectar",
    shadow_color: "Cor da sombra", fade: "Esfriamento (s)",
    glow: "Halo", glow_when: "Halo quando", glow_blur: "Tamanho do halo",
    glow_opacity: "Opacidade do halo",
    color_detected: "Cor detectado", color_clear: "Cor livre",
    color_unavailable: "Cor indisponível", color_unknown: "Cor desconhecido",
    icon_size: "Tamanho do ícone", icon_scale: "Escala do ícone",
    icon_offset_y: "Deslocar ícone (Y)", icon_opacity_clear: "Opacidade do ícone (livre)",
    invert: "Inverter estado", show_age: "Mostrar tempo no tooltip",
    haptic: "Vibração no toque", lock_when_broken: "Travar toque se indisponível",
    hide_clear: "Esconder quando livre", hide_detected: "Esconder ao detectar",
    tap_action: "Toque", hold_action: "Toque longo", double_tap_action: "Toque duplo",
  };

  const sel = (options) => ({ select: { mode: "dropdown", options } });

  const SCHEMA = [
    { name: "entity", required: true, selector: { entity: {} } },
    { name: "name", selector: { text: {} } },
    {
      type: "grid", name: "", schema: [
        { name: "left", selector: { text: {} } },
        { name: "top", selector: { text: {} } },
        { name: "size", selector: { text: {} } },
        { name: "scale", selector: { number: { min: 0.1, max: 5, step: 0.05, mode: "box" } } },
      ],
    },
    {
      type: "grid", name: "", schema: [
        {
          name: "animation", selector: sel([
            { value: "radar", label: "Radar (padrão)" },
            { value: "pulse", label: "Pulso" },
            { value: "beacon", label: "Farol" },
            { value: "blink", label: "Piscada" },
            { value: "none", label: "Nenhuma" },
          ]),
        },
        {
          name: "animation_when", selector: sel([
            { value: "detected", label: "Só ao detectar (padrão)" },
            { value: "always", label: "Sempre" },
            { value: "never", label: "Nunca" },
          ]),
        },
        {
          name: "plate", selector: sel([
            { value: "none", label: "Sem placa (padrão)" },
            { value: "circle", label: "Círculo" },
            { value: "rounded", label: "Cantos suaves" },
            { value: "square", label: "Quadrada" },
          ]),
        },
        { name: "elevation", selector: { number: { min: 0, max: 5, step: 1, mode: "box" } } },
      ],
    },
    {
      type: "grid", name: "", schema: [
        {
          name: "effect", selector: sel([
            { value: "glow", label: "Glow (padrão)" },
            { value: "neon", label: "Neon" },
            { value: "soft", label: "Suave" },
            { value: "flat", label: "Chapado" },
          ]),
        },
        {
          name: "icon_set", selector: sel([
            { value: "", label: "Mesmo ícone nos dois estados" },
            { value: "auto", label: "Automático (device_class)" },
            { value: "motion", label: "Movimento" },
            { value: "occupancy", label: "Ocupação" },
            { value: "presence", label: "Presença" },
            { value: "moving", label: "Em movimento" },
          ]),
        },
        { name: "icon", selector: { icon: {} } },
        { name: "elevation_detected", selector: { number: { min: 0, max: 5, step: 1, mode: "box" } } },
      ],
    },
    {
      type: "grid", name: "", schema: [
        { name: "glow", selector: { boolean: {} } },
        { name: "invert", selector: { boolean: {} } },
        { name: "show_age", selector: { boolean: {} } },
        { name: "haptic", selector: { boolean: {} } },
        { name: "hide_clear", selector: { boolean: {} } },
        { name: "hide_detected", selector: { boolean: {} } },
        { name: "lock_when_broken", selector: { boolean: {} } },
        { name: "reduced_motion", selector: { boolean: {} } },
      ],
    },
    {
      type: "expandable", name: "", title: "Cores e ajuste fino", schema: [
        {
          type: "grid", name: "", schema: [
            { name: "color_detected", selector: { text: {} } },
            { name: "color_clear", selector: { text: {} } },
            { name: "color_unavailable", selector: { text: {} } },
            { name: "color_unknown", selector: { text: {} } },
          ],
        },
        {
          type: "grid", name: "", schema: [
            {
              name: "glow_when", selector: sel([
                { value: "detected", label: "Só ao detectar (padrão)" },
                { value: "always", label: "Sempre" },
                { value: "never", label: "Nunca" },
              ]),
            },
            { name: "glow_blur", selector: { text: {} } },
            { name: "glow_opacity", selector: { number: { min: 0, max: 1, step: 0.05, mode: "box" } } },
            { name: "fade", selector: { number: { min: 0, max: 5, step: 0.1, mode: "box" } } },
            { name: "animation_speed", selector: { number: { min: 0.4, max: 10, step: 0.1, mode: "box" } } },
            { name: "rings", selector: { number: { min: 1, max: 2, step: 1, mode: "box" } } },
            { name: "ring_spread", selector: { number: { min: 1, max: 4, step: 0.05, mode: "box" } } },
            { name: "plate_opacity", selector: { number: { min: 0, max: 1, step: 0.02, mode: "box" } } },
            { name: "plate_radius", selector: { text: {} } },
            { name: "plate_frost", selector: { number: { min: 0, max: 20, step: 1, mode: "box" } } },
            { name: "ring", selector: { text: {} } },
            { name: "shadow_color", selector: { text: {} } },
            { name: "icon_size", selector: { text: {} } },
            { name: "icon_scale", selector: { number: { min: 0.1, max: 3, step: 0.05, mode: "box" } } },
            { name: "icon_offset_y", selector: { text: {} } },
            { name: "icon_opacity_clear", selector: { number: { min: 0, max: 1, step: 0.05, mode: "box" } } },
            { name: "rotate", selector: { number: { min: -180, max: 180, step: 1, mode: "box" } } },
          ],
        },
      ],
    },
    {
      type: "expandable", name: "", title: "Ações", schema: [
        { name: "tap_action", selector: { ui_action: {} } },
        { name: "hold_action", selector: { ui_action: {} } },
        { name: "double_tap_action", selector: { ui_action: {} } },
      ],
    },
  ];

  class MwOccupancyMotionElementEditor extends HTMLElement {
    setConfig(config) { this._config = config || {}; this._render(); }
    set hass(hass) { this._hass = hass; this._render(); }

    _render() {
      if (!this._config || !this._hass) return;
      if (!this._form) {
        const f = document.createElement("ha-form");
        f.computeLabel = (s) => LABELS[s.name] || s.name;
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const next = { type: "custom:mw-occupancy-motion-element", ...ev.detail.value };
          Object.keys(next).forEach((k) => {
            if (next[k] === "" || next[k] === null || next[k] === undefined) delete next[k];
          });
          fire(this, "config-changed", { config: next });
        });
        this.appendChild(f);
        this._form = f;
      }
      this._form.hass = this._hass;
      this._form.schema = SCHEMA;
      // o formulário mostra o padrão em vigor, não campo vazio
      const data = { ...this._config };
      ["size", "effect", "animation", "animation_when", "plate", "elevation",
        "glow", "glow_when", "show_age", "haptic", "reduced_motion",
        "lock_when_broken", "tap_action", "hold_action"].forEach((k) => {
          if (data[k] === undefined) data[k] = DEFAULTS[k];
        });
      this._form.data = data;
    }
  }

  if (!customElements.get("mw-occupancy-motion-element")) {
    customElements.define("mw-occupancy-motion-element", MwOccupancyMotionElement);
  }
  if (!customElements.get("mw-occupancy-motion-element-editor")) {
    customElements.define("mw-occupancy-motion-element-editor",
      MwOccupancyMotionElementEditor);
  }

  console.info(
    `%c MW-OCCUPANCY-MOTION-ELEMENT %c ${VERSION} `,
    "color:#0b1021;background:#ffa726;font-weight:700",
    "color:#ffa726;background:#0b1021"
  );
})();
