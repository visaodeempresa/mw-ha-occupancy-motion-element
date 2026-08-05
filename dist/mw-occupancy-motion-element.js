/* mw-ha-occupancy-motion-element — custom:mw-occupancy-motion-element
 * Elemento de picture-elements: o sensor de movimento/presença na planta.
 * Troca o `type: state-icon` cru (que só sabe pintar o ícone) por um
 * elemento com placa, halo, elevação, animação e transição de esfriamento —
 * tudo opcional e desligável.
 *
 * Leveza é requisito, não detalhe:
 *   · a árvore do shadow DOM é montada UMA vez; a mudança de estado só troca
 *     custom properties e a classe do host — sem innerHTML a cada evento;
 *   · as animações mexem só em `transform`/`opacity` (compositor, sem
 *     layout/paint) e, por padrão, só rodam no estado DETECTADO — parado, a
 *     planta não gasta um frame;
 *   · quem pede `prefers-reduced-motion` não recebe animação nenhuma.
 *
 * JS puro, arquivo único, sem build.
 * Repo: https://github.com/visaodeempresa/mw-ha-occupancy-motion-element
 * Releases automáticas: push na main → bump semântico → tag → HACS.
 */
(() => {
  "use strict";

  const DEFAULTS = {
    // --- entidade ---
    entity: "",
    name: "",                   // tooltip; vazio = friendly_name da entidade
    invert: false,              // entidade invertida (on = livre)
    show_age: true,             // tooltip ganha "· há 3 min" (sem timer, só no render)

    // --- geometria (dá para posicionar pelo `style:` do picture-elements;
    //     o que estiver aqui vence o `style:`) ---
    left: "",                   // ex.: "35.5%"
    top: "",                    // ex.: "14%"
    size: "6vh",                // caixa do elemento (width = height)
    scale: null,                // escala do conjunto (null = não mexe)
    rotate: null,

    // --- ícone ---
    icon: "",                   // força o ícone em todos os estados
    icon_set: "",               // auto | motion | occupancy | presence | moving
    icon_detected: "",          // vazio = ícone da entidade, senão o fallback
    icon_clear: "",             // vazio = mesmo ícone do detectado (como o state-icon)
    icon_unavailable: "mdi:cancel",
    icon_unknown: "mdi:crosshairs-question",
    icon_fallback: "mdi:motion-sensor",
    icon_size: "3.6vh",
    icon_scale: 1,
    icon_opacity_detected: 1,
    icon_opacity_clear: 0.75,
    icon_opacity_unavailable: 0.9,
    icon_opacity_unknown: 0.9,
    icon_offset_y: "0",
    icon_upright: false,        // true = desfaz o `rotate` só no ícone

    // --- cores por estado (aceitam var(--...), #hex, rgb/rgba e nome) ---
    color_detected: "var(--mw-presence-color, #ffa726)",
    color_clear: "rgba(176, 190, 197, 0.55)",
    color_unavailable: "rgba(255, 99, 71, 0.85)",
    color_unknown: "rgba(255, 99, 71, 0.85)",

    // --- halo (drop-shadow no ícone: segue o desenho, não a caixa) ---
    glow: true,
    glow_blur: "1.1vh",
    glow_opacity: 0.7,          // alfa do halo derivado da cor do estado
    glow_when: "detected",      // detected | always | never
    glow_color_detected: "", glow_color_clear: "",
    glow_color_unavailable: "", glow_color_unknown: "",

    // --- placa por baixo do ícone (a "superfície" que recebe a elevação) ---
    plate: "none",              // none | circle | rounded | square
    plate_radius: "26%",        // só no rounded
    plate_opacity: 0.16,        // alfa da placa derivada da cor do estado
    plate_color_detected: "", plate_color_clear: "",
    plate_color_unavailable: "", plate_color_unknown: "",
    plate_frost: 0,             // px de backdrop-filter (vidro fosco) — CARO, use com parcimônia
    ring: 0,                    // px da borda da placa
    ring_opacity: 0.55,
    ring_color_detected: "", ring_color_clear: "",
    ring_color_unavailable: "", ring_color_unknown: "",

    // --- elevação / sombra ---
    elevation: 0,               // 0–5 (placa: box-shadow · sem placa: drop-shadow no ícone)
    elevation_detected: null,   // sobrepõe `elevation` quando detectado
    shadow: "",                 // CSS cru de box-shadow (vence a elevação)
    icon_shadow: "",            // CSS cru de filter (vence a elevação, sem placa)
    shadow_color: "",           // tinge as sombras prontas (#hex ou rgb)

    // --- animação (transform/opacity apenas) ---
    animation: "radar",         // none | pulse | radar | beacon | blink
    animation_when: "detected", // detected | always | never
    animation_speed: 2.4,       // segundos por ciclo
    rings: 2,                   // anéis do radar (1 ou 2)
    ring_spread: 1.75,          // até onde o anel cresce
    reduced_motion: true,       // respeita prefers-reduced-motion

    // --- esfriamento: a cor não estala, esvai ---
    fade: 0.7,                  // segundos de transição entre estados

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
    navigation_path: "",
    url_path: "",
    service: "",
    service_data: null,
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

  // Material-ish: par de sombras (próxima + difusa) por degrau
  const ELEV_BOX = [
    "none",
    "0 1px 2px rgba(0,0,0,0.30), 0 1px 3px rgba(0,0,0,0.18)",
    "0 2px 4px rgba(0,0,0,0.30), 0 3px 6px rgba(0,0,0,0.20)",
    "0 4px 8px rgba(0,0,0,0.30), 0 6px 12px rgba(0,0,0,0.22)",
    "0 8px 16px rgba(0,0,0,0.32), 0 12px 24px rgba(0,0,0,0.24)",
    "0 12px 24px rgba(0,0,0,0.34), 0 20px 40px rgba(0,0,0,0.26)",
  ];
  // sem placa a sombra tem que seguir o contorno do ícone → drop-shadow
  const ELEV_ICON = [
    "",
    "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
    "drop-shadow(0 2px 2px rgba(0,0,0,0.38))",
    "drop-shadow(0 3px 4px rgba(0,0,0,0.40))",
    "drop-shadow(0 5px 6px rgba(0,0,0,0.42))",
    "drop-shadow(0 7px 9px rgba(0,0,0,0.45))",
  ];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const num = (v, d) => (v === null || v === undefined || v === "" || isNaN(Number(v))
    ? d : Number(v));

  const px = (v) => (v === null || v === undefined || v === "" ? "0"
    : typeof v === "number" || /^-?[\d.]+$/.test(String(v)) ? `${v}px` : String(v));

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
    const ev = new CustomEvent(type, { detail, bubbles: true, composed: true });
    node.dispatchEvent(ev);
    return ev;
  };

  class MwOccupancyMotionElement extends HTMLElement {
    static getStubConfig() {
      return { entity: "", left: "50%", top: "50%", size: "6vh" };
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._sig = null;
      this._holdFired = false;
      this.addEventListener("click", (e) => {
        if (this._holdFired) { this._holdFired = false; return; }
        e.stopPropagation();
        this._run(this._config && this._config.tap_action, true);
      });
      this.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this._run(this._config && this._config.double_tap_action, true);
      });
      this.addEventListener("pointerdown", () => {
        this._holdTimer = setTimeout(() => {
          this._holdFired = true;
          this._run(this._config && this._config.hold_action);
        }, 500);
      });
      const cancel = () => clearTimeout(this._holdTimer);
      this.addEventListener("pointerup", cancel);
      this.addEventListener("pointercancel", cancel);
      this.addEventListener("pointerleave", cancel);
    }

    setConfig(config) {
      if (!config || !config.entity) {
        throw new Error("mw-occupancy-motion-element: informe 'entity'");
      }
      this._config = { ...DEFAULTS, ...config };
      this._sig = null;
      this._applyGeometry();
      this._build();
      this._update();
    }

    set hass(hass) {
      this._hass = hass;
      this._update();
    }

    get hass() { return this._hass; }

    // o picture-elements aplica o `style:` do YAML no host logo depois de
    // criar o elemento; o que vier na config vence, e o que não vier não é
    // tocado — assim dá para posicionar dos dois jeitos
    _applyGeometry() {
      const c = this._config;
      const set = (prop, val) => {
        if (val === "" || val === null || val === undefined) return;
        this.style.setProperty(prop, String(val));
      };
      set("left", c.left);
      set("top", c.top);
      set("width", c.size);
      set("height", c.size);
      const hasR = c.rotate !== null && c.rotate !== "";
      const hasS = c.scale !== null && c.scale !== "";
      if (hasR || hasS) {
        const r = hasR ? c.rotate : 0;
        const s = hasS ? c.scale : 1;
        set("transform", `translate(-50%, -50%) rotate(${r}deg) scale(${s})`);
      }
    }

    // ---- estrutura: montada uma vez, nunca mais tocada -------------------
    // Camadas empilhadas em `inset:0` para que toda animação seja um
    // `transform`/`opacity` puro — nada de recentralizar no keyframe.
    _build() {
      const c = this._config;
      const radius = { circle: "50%", rounded: c.plate_radius, square: "0" }[c.plate] || "50%";
      const spd = num(c.animation_speed, 2.4);
      const spread = num(c.ring_spread, 1.75);
      const upright = c.icon_upright && c.rotate ? ` rotate(${-c.rotate}deg)` : "";
      const frost = num(c.plate_frost, 0) > 0
        ? `backdrop-filter:blur(${num(c.plate_frost, 0)}px);-webkit-backdrop-filter:blur(${num(c.plate_frost, 0)}px);`
        : "";
      const reduce = c.reduced_motion ? `
  @media (prefers-reduced-motion: reduce){
    .ico,.rings i,.aura{animation:none !important;}
  }` : "";

      this.shadowRoot.innerHTML = `
<style>
  :host{position:absolute;box-sizing:border-box;overflow:visible;display:block;
        --mw-fade:${num(c.fade, 0.7)}s;--mw-spd:${spd}s;}
  :host(.is-hidden){display:none;}
  .plate,.aura,.rings,.box{position:absolute;inset:0;pointer-events:none;}
  .plate{display:${c.plate === "none" ? "none" : "block"};border-radius:${radius};
         background:var(--mw-plate);box-shadow:var(--mw-elev);${frost}
         ${num(c.ring, 0) > 0 ? `border:${px(c.ring)} solid var(--mw-ring);` : ""}
         transition:background var(--mw-fade) ease,border-color var(--mw-fade) ease,
                    box-shadow var(--mw-fade) ease;}
  .aura{display:none;border-radius:50%;
        background:radial-gradient(circle, var(--mw-glow) 0%, transparent 68%);}
  .rings{display:none;}
  .rings i{position:absolute;inset:0;border-radius:50%;
           border:2px solid var(--mw-c);opacity:0;transform:scale(0.35);}
  .rings i:nth-child(2){animation-delay:calc(var(--mw-spd) / -2);}
  .box{display:flex;align-items:center;justify-content:center;
       transform:translateY(${c.icon_offset_y})${upright};}
  .ico{--mdc-icon-size:${c.icon_size};color:var(--mw-c);opacity:var(--mw-op);
       filter:var(--mw-ico-filter);transform:scale(${num(c.icon_scale, 1)});
       transition:color var(--mw-fade) ease,filter var(--mw-fade) ease,
                  opacity var(--mw-fade) ease;}

  /* ---- animações: só transform/opacity, só quando a classe entra ---- */
  @keyframes mw-pulse{0%,100%{transform:scale(${num(c.icon_scale, 1)});}
                      50%{transform:scale(${(num(c.icon_scale, 1) * 1.14).toFixed(3)});}}
  @keyframes mw-blink{0%,14%,28%,100%{opacity:var(--mw-op);}
                      7%,21%{opacity:0.15;}}
  @keyframes mw-breathe{0%,100%{opacity:0.25;transform:scale(0.9);}
                        50%{opacity:0.7;transform:scale(1.12);}}
  @keyframes mw-ring{0%{transform:scale(0.35);opacity:0.6;}
                     70%{opacity:0.12;}
                     100%{transform:scale(${spread});opacity:0;}}

  :host(.a-pulse) .ico{animation:mw-pulse var(--mw-spd) ease-in-out infinite;
                       will-change:transform;}
  :host(.a-blink) .ico{animation:mw-blink var(--mw-spd) steps(1,end) infinite;
                       will-change:opacity;}
  :host(.a-beacon) .aura{display:block;
                         animation:mw-breathe var(--mw-spd) ease-in-out infinite;
                         will-change:transform,opacity;}
  :host(.a-radar) .rings{display:block;}
  :host(.a-radar) .rings i{animation:mw-ring var(--mw-spd) ease-out infinite;
                           will-change:transform,opacity;}${reduce}
</style>
<div class="plate"></div>
<div class="aura"></div>
<div class="rings"><i></i>${num(c.rings, 2) > 1 ? "<i></i>" : ""}</div>
<div class="box"><ha-icon class="ico"></ha-icon></div>`;
      this._ico = this.shadowRoot.querySelector(".ico");
    }

    // ---- estado: custom properties + classe do host ---------------------
    _update() {
      const cfg = this._config;
      const hass = this._hass;
      if (!cfg || !hass || !this._ico) return;

      const st = hass.states[cfg.entity];
      const attrs = (st && st.attributes) || {};
      const mode = resolveMode(st && st.state, cfg.invert);
      this._mode = mode;

      const sig = `${mode}|${attrs.icon || ""}|${attrs.friendly_name || ""}`;
      const changed = sig !== this._sig;
      this._sig = sig;

      // tooltip é barato e muda com o relógio → sempre atualizado
      const label = { detected: "detectado", clear: "livre",
        unavailable: "indisponível", unknown: "desconhecido" }[mode];
      const age = cfg.show_age && st ? ago(st.last_changed) : "";
      this.title = `${cfg.name || attrs.friendly_name || cfg.entity} · ${label}${age ? " " + age : ""}`;
      if (!changed) return;

      const color = cfg[`color_${mode}`];
      const set = (k, v) => this.style.setProperty(k, v);

      set("--mw-c", color);
      set("--mw-op", String(cfg[`icon_opacity_${mode}`]));

      const glowOn = cfg.glow && cfg.glow_when !== "never"
        && (cfg.glow_when === "always" || mode === "detected");
      const glowColor = cfg[`glow_color_${mode}`] || withAlpha(color, cfg.glow_opacity);
      set("--mw-glow", glowOn ? glowColor : "transparent");

      set("--mw-plate", cfg.plate === "none" ? "transparent"
        : (cfg[`plate_color_${mode}`] || withAlpha(color, cfg.plate_opacity)));
      set("--mw-ring", cfg[`ring_color_${mode}`] || withAlpha(color, cfg.ring_opacity));

      // elevação: na placa vira box-shadow; sem placa, drop-shadow no ícone
      const lvlRaw = mode === "detected" && cfg.elevation_detected !== null
        && cfg.elevation_detected !== "" ? cfg.elevation_detected : cfg.elevation;
      const lvl = Math.max(0, Math.min(5, Math.round(num(lvlRaw, 0))));
      const hasPlate = cfg.plate !== "none";
      set("--mw-elev", hasPlate
        ? (cfg.shadow || tint(ELEV_BOX[lvl], cfg.shadow_color)) : "none");

      const filters = [];
      if (glowOn) filters.push(`drop-shadow(0 0 ${px(cfg.glow_blur)} ${glowColor})`);
      if (cfg.icon_shadow) filters.push(cfg.icon_shadow);
      else if (!hasPlate && ELEV_ICON[lvl]) filters.push(tint(ELEV_ICON[lvl], cfg.shadow_color));
      set("--mw-ico-filter", filters.length ? filters.join(" ") : "none");

      // ícone: `icon` manda em tudo; senão o par do `icon_set`/device_class;
      // senão o ícone da própria entidade; livre herda o do detectado
      const set2 = cfg.icon_set === "auto"
        ? ICON_SETS[DEVICE_CLASS_SET[attrs.device_class]] : ICON_SETS[cfg.icon_set];
      const fromSet = set2 ? (mode === "detected" ? set2[0] : set2[1]) : "";
      const icon = cfg.icon
        || (mode === "detected" || mode === "clear"
          ? (fromSet || cfg[`icon_${mode}`] || cfg.icon_detected
            || attrs.icon || cfg.icon_fallback)
          : cfg[`icon_${mode}`]);
      this._ico.setAttribute("icon", icon);

      const anim = cfg.animation && cfg.animation !== "none"
        && cfg.animation_when !== "never"
        && (cfg.animation_when === "always" || mode === "detected") ? cfg.animation : "";
      const tap = typeof cfg.tap_action === "string"
        ? cfg.tap_action : (cfg.tap_action || {}).action;
      const locked = cfg.lock_when_broken && (mode === "unavailable" || mode === "unknown");
      const clickable = String(tap) !== "none" && !locked;

      // só as classes nossas são trocadas — o que o picture-elements tiver
      // posto no host continua lá
      const keep = String(this.className || "").split(/\s+/)
        .filter((x) => x && !/^(s-|a-|is-hidden$)/.test(x));
      this.className = keep.concat([`s-${mode}`, anim ? `a-${anim}` : "",
        cfg[`hide_${mode}`] ? "is-hidden" : ""].filter(Boolean)).join(" ");
      this.style.setProperty("cursor", clickable ? "pointer" : "default");
    }

    _run(spec, guarded) {
      const cfg = this._config;
      if (!cfg || !this._hass) return;
      if (guarded && cfg.lock_when_broken
        && (this._mode === "unavailable" || this._mode === "unknown")) return;
      const a = typeof spec === "string" ? { action: spec } : (spec || { action: "none" });
      switch (a.action) {
        case "none":
          return;
        case "toggle":
          this._hass.callService("homeassistant", "toggle",
            { entity_id: a.entity_id || cfg.entity });
          return;
        case "call-service":
        case "perform-action": {
          const svc = a.perform_action || a.service || cfg.service;
          if (!svc || svc.indexOf(".") < 0) return;
          const [dom, srv] = svc.split(".");
          this._hass.callService(dom, srv,
            a.data || a.service_data || cfg.service_data || {}, a.target);
          return;
        }
        case "navigate": {
          const path = a.navigation_path || cfg.navigation_path;
          if (!path) return;
          history.pushState(null, "", path);
          fire(window, "location-changed", { replace: false });
          return;
        }
        case "url": {
          const url = a.url_path || cfg.url_path;
          if (url) window.open(url, a.new_tab === false ? "_self" : "_blank");
          return;
        }
        default:
          fire(this, "hass-more-info", { entityId: a.entity || cfg.entity });
      }
    }
  }

  if (!customElements.get("mw-occupancy-motion-element")) {
    customElements.define("mw-occupancy-motion-element", MwOccupancyMotionElement);
  }

  console.info(
    "%c MW-OCCUPANCY-MOTION-ELEMENT %c 0.1.0 ",
    "color:#0b1021;background:#ffa726;font-weight:700",
    "color:#ffa726;background:#0b1021"
  );
})();
