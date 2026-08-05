/* Probe headless — instancia o elemento fora do navegador (shim mínimo de DOM)
 * e confere o que some quando alguém mexe: modo por estado, cores/halo/placa
 * em custom properties, elevação com e sem placa, animação só no detectado,
 * ícones, geometria proporcional, o caminho rápido do `set hass`, o ponteiro
 * e o editor.
 * Roda no CI e antes de qualquer push:  node tools/probe.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const mkStyle = () => {
  const s = { _p: {} };
  s.setProperty = (k, v) => { s._p[k] = v; s[k] = v; };
  s.removeProperty = (k) => { delete s._p[k]; delete s[k]; };
  return s;
};

class Node {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.style = mkStyle();
    this.children = [];
    this._attrs = {};
    this._listeners = {};
  }
  appendChild(n) { this.children.push(n); return n; }
  append(...n) { n.forEach((x) => this.children.push(x)); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  dispatchEvent() { return true; }
  emit(t, ev) { (this._listeners[t] || []).forEach((f) => f(ev)); }
}

global.HTMLElement = class extends Node {
  attachShadow() {
    this.shadowRoot = new Node("shadow-root");
    this.shadowRoot.adoptedStyleSheets = [];
    return this.shadowRoot;
  }
};
global.document = { createElement: (t) => new Node(t) };
const reg = {};
global.customElements = { define: (n, c) => (reg[n] = c), get: (n) => reg[n] };
global.window = {};
global.CustomEvent = class { constructor(t, d) { this.type = t; Object.assign(this, d); } };
global.CSSStyleSheet = class { replaceSync(css) { this.css = css; } };
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
console.info = () => {};

eval(fs.readFileSync(
  path.join(__dirname, "..", "dist", "mw-occupancy-motion-element.js"), "utf8"));

const now = new Date().toISOString();
const mkState = (state, attributes, changed) => ({
  state, attributes: attributes || {}, last_changed: changed || now,
});
const hass = {
  states: {
    "binary_sensor.movimento_na_cozinha": mkState("on",
      { friendly_name: "MOVIMENTO NA COZINHA", device_class: "motion" }),
    "binary_sensor.movimento_na_sala": mkState("off",
      { friendly_name: "Movimento na Sala", device_class: "motion" }),
    "binary_sensor.presenca_no_quarto": mkState("on",
      { friendly_name: "Presença no Quarto", device_class: "occupancy" }),
    "binary_sensor.sumido": mkState("unavailable"),
    "binary_sensor.esquisito": mkState("banana"),
    "binary_sensor.com_icone": mkState("off", { icon: "mdi:radar" }),
  },
  calls: [],
  callService(dom, srv, data) { this.calls.push([dom, srv, data]); },
};

let fails = 0;
const check = (label, cond, extra = "") => {
  if (cond) { console.log(`  ok   ${label}`); return; }
  fails += 1;
  console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`);
};

const make = (config) => {
  const el = new reg["mw-occupancy-motion-element"]();
  el.setConfig(config);
  el.hass = hass;
  return el;
};
const p = (el, k) => el.style._p[k];

console.log("elemento:");

// ---- detectado -------------------------------------------------------------
const on = make({ entity: "binary_sensor.movimento_na_cozinha" });
check("modo vira atributo do host", on.getAttribute("mode") === "detected");
check("detectado usa a cor de presença",
  p(on, "--mw-c") === "var(--mw-presence-color, #ffa726)", p(on, "--mw-c"));
check("halo de cor var() sai por color-mix",
  /color-mix\(in srgb, var\(--mw-presence-color, #ffa726\) 70%, transparent\)/
    .test(p(on, "--mw-glow")), p(on, "--mw-glow"));
check("halo entra como drop-shadow no ícone em cqmin",
  p(on, "--mw-ico-filter").startsWith("drop-shadow(0 0 12cqmin color-mix"),
  p(on, "--mw-ico-filter"));
check("detectado anima radar", on.getAttribute("anim") === "radar");
check("ícone padrão é mdi:motion-sensor", on._ico.getAttribute("icon") === "mdi:motion-sensor");
check("tooltip traz estado e idade",
  /MOVIMENTO NA COZINHA · detectado há \d+s/.test(on.title), on.title);
check("sem placa a placa não é desenhada", p(on, "--mw-plate-display") === "none");
check("estrutura montada uma vez: aura, anéis e press",
  on.shadowRoot.children.length === 3
  && on.shadowRoot.children[1].children.length === 2, on.shadowRoot.children.length);
check("folha de estilo é compartilhada (adoptedStyleSheets)",
  on.shadowRoot.adoptedStyleSheets.length === 1);
const on2 = make({ entity: "binary_sensor.movimento_na_cozinha" });
check("segunda instância reaproveita a MESMA folha",
  on2.shadowRoot.adoptedStyleSheets[0] === on.shadowRoot.adoptedStyleSheets[0]);

// ---- livre -----------------------------------------------------------------
const off = make({ entity: "binary_sensor.movimento_na_sala" });
check("livre pinta cinza-azulado", p(off, "--mw-c") === "rgba(176, 190, 197, 0.55)");
check("livre não gasta halo no ícone", p(off, "--mw-ico-filter") === "none");
check("livre não anima nada", off.getAttribute("anim") === null);
check("livre baixa a opacidade do ícone", p(off, "--mw-icon-op") === "0.75");
check("livre mantém o mesmo ícone do detectado",
  off._ico.getAttribute("icon") === "mdi:motion-sensor");

// ---- exceções --------------------------------------------------------------
const gone = make({ entity: "binary_sensor.sumido" });
check("indisponível usa mdi:cancel tomate",
  gone._ico.getAttribute("icon") === "mdi:cancel"
  && p(gone, "--mw-c") === "rgba(255, 99, 71, 0.85)");
const weird = make({ entity: "binary_sensor.esquisito" });
check("estado fora das listas vira desconhecido",
  weird.getAttribute("mode") === "unknown"
  && weird._ico.getAttribute("icon") === "mdi:crosshairs-question");
const missing = make({ entity: "binary_sensor.nao_existe" });
check("entidade inexistente vira indisponível",
  missing.getAttribute("mode") === "unavailable");

// ---- ícones ----------------------------------------------------------------
check("ícone da própria entidade é respeitado",
  make({ entity: "binary_sensor.com_icone" })._ico.getAttribute("icon") === "mdi:radar");
check("icon_set:auto lê o device_class occupancy",
  make({ entity: "binary_sensor.presenca_no_quarto", icon_set: "auto" })
    ._ico.getAttribute("icon") === "mdi:home-account");
check("icon_set:motion troca o ícone do livre",
  make({ entity: "binary_sensor.movimento_na_sala", icon_set: "motion" })
    ._ico.getAttribute("icon") === "mdi:motion-sensor-off");
check("`icon` manda em todos os estados",
  make({ entity: "binary_sensor.sumido", icon: "mdi:ghost" })
    ._ico.getAttribute("icon") === "mdi:ghost");

// ---- placa, elevação e sombra ---------------------------------------------
const plate = make({
  entity: "binary_sensor.movimento_na_sala", plate: "circle", elevation: 3, ring: "6%",
});
check("placa entra no layout", p(plate, "--mw-plate-display") === "block");
check("placa deriva a cor do estado com alfa 0.16",
  p(plate, "--mw-plate") === "rgba(176, 190, 197, 0.16)", p(plate, "--mw-plate"));
check("borda da placa vira box-shadow inset em cqmin",
  p(plate, "--mw-ring") === "inset 0 0 0 6cqmin rgba(176, 190, 197, 0.55)",
  p(plate, "--mw-ring"));
check("com placa a elevação vira box-shadow em cqmin",
  p(plate, "--mw-elev").startsWith("0 5cqmin 10cqmin rgba(0,0,0,0.32)"), p(plate, "--mw-elev"));
check("com placa o ícone não ganha drop-shadow de elevação",
  p(plate, "--mw-ico-filter") === "none");

const flat = make({ entity: "binary_sensor.movimento_na_sala", elevation: 2 });
check("sem placa a elevação vira drop-shadow no ícone",
  p(flat, "--mw-ico-filter") === "drop-shadow(0 3cqmin 3cqmin rgba(0,0,0,0.38))",
  p(flat, "--mw-ico-filter"));
check("sem placa não há box-shadow", p(flat, "--mw-elev") === "0 0 0 0 rgba(0,0,0,0)");

const tinted = make({
  entity: "binary_sensor.movimento_na_sala", plate: "rounded",
  elevation: 1, shadow_color: "#102030",
});
check("shadow_color tinge a sombra preservando o alfa",
  p(tinted, "--mw-elev").startsWith("0 1.5cqmin 3cqmin rgba(16,32,48,0.30)"),
  p(tinted, "--mw-elev"));
check("plate rounded usa o raio configurado", p(tinted, "--mw-radius") === "26%");
check("plate circle é redondo",
  p(make({ entity: "binary_sensor.movimento_na_sala", plate: "circle" }), "--mw-radius") === "50%");
check("plate square não tem raio",
  p(make({ entity: "binary_sensor.movimento_na_sala", plate: "square" }), "--mw-radius") === "0");
check("`shadow` cru vence a elevação",
  p(make({ entity: "binary_sensor.movimento_na_sala", plate: "square", shadow: "0 0 9px red" }),
    "--mw-elev") === "0 0 9px red");
check("elevation_detected sobe a placa só quando detecta",
  p(make({
    entity: "binary_sensor.movimento_na_cozinha", plate: "circle",
    elevation: 1, elevation_detected: 4,
  }), "--mw-elev").startsWith("0 8cqmin 16cqmin"));
check("vidro fosco vira backdrop-filter",
  p(make({ entity: "binary_sensor.movimento_na_sala", plate: "circle", plate_frost: 6 }),
    "--mw-frost") === "blur(6px)");

// ---- efeitos ---------------------------------------------------------------
check("effect:neon engorda o halo",
  p(make({ entity: "binary_sensor.movimento_na_cozinha", effect: "neon" }), "--mw-ico-filter")
    .startsWith("drop-shadow(0 0 20.4cqmin"));
check("effect:flat apaga o halo",
  p(make({ entity: "binary_sensor.movimento_na_cozinha", effect: "flat" }),
    "--mw-ico-filter") === "none");

// ---- animação --------------------------------------------------------------
check("animation:pulse marca o atributo",
  make({ entity: "binary_sensor.movimento_na_cozinha", animation: "pulse" })
    .getAttribute("anim") === "pulse");
check("animation_when:always anima também no livre",
  make({ entity: "binary_sensor.movimento_na_sala", animation: "beacon", animation_when: "always" })
    .getAttribute("anim") === "beacon");
check("animation_when:never não anima nada",
  make({ entity: "binary_sensor.movimento_na_cozinha", animation_when: "never" })
    .getAttribute("anim") === null);
check("animation:none não anima nada",
  make({ entity: "binary_sensor.movimento_na_cozinha", animation: "none" })
    .getAttribute("anim") === null);
check("prefers-reduced-motion está na folha",
  on.shadowRoot.adoptedStyleSheets[0].css.includes("prefers-reduced-motion"));
check("reduced_motion:false marca o host para continuar animando",
  make({ entity: "binary_sensor.movimento_na_cozinha", reduced_motion: false })
    .getAttribute("mw-motion") === "");
check("rings:1 esconde o segundo anel",
  p(make({ entity: "binary_sensor.movimento_na_cozinha", rings: 1 }), "--mw-ring2") === "none");
check("velocidade e esfriamento viram custom properties",
  p(on, "--mw-spd") === "2.4s" && p(on, "--mw-fade") === "0.7s");
check("espessura do anel do radar em cqmin", p(on, "--mw-ring-w") === "4cqmin");

// ---- geometria -------------------------------------------------------------
const geo = make({ entity: "binary_sensor.movimento_na_cozinha", left: "35.5%", top: "14%" });
check("geometria vai para o host",
  geo.style.left === "35.5%" && geo.style.top === "14%" && p(geo, "--mw-size") === "6%",
  JSON.stringify(geo.style._p));
check("o translate que centra no ponto está sempre lá",
  geo.style.transform === "translate(-50%, -50%)", geo.style.transform);
check("scale/rotate compõem com o translate",
  make({ entity: "binary_sensor.movimento_na_cozinha", scale: 0.6, rotate: 30 })
    .style.transform === "translate(-50%, -50%) rotate(30deg) scale(0.6)");
check("icon_upright desfaz a rotação só no ícone",
  p(make({ entity: "binary_sensor.movimento_na_cozinha", rotate: 30, icon_upright: true }),
    "--mw-icon-rot") === "rotate(-30deg)");
check("sem size na config o host não recebe tamanho (vale o `style:` do YAML)",
  p(make({ entity: "binary_sensor.movimento_na_cozinha", size: "" }), "--mw-size") === undefined);
check("icon_size em % vira cqmin",
  p(make({ entity: "binary_sensor.movimento_na_cozinha", icon_size: "70%" }),
    "--mw-icon-size") === "70cqmin");

// ---- estado, visibilidade e ações -----------------------------------------
check("invert:true troca detectado por livre",
  make({ entity: "binary_sensor.movimento_na_cozinha", invert: true })
    .getAttribute("mode") === "clear");
check("hide_clear some com o elemento",
  make({ entity: "binary_sensor.movimento_na_sala", hide_clear: true })
    .getAttribute("mw-hidden") === "");
check("tap padrão é more-info → cursor de mão", p(on, "--mw-cursor") === "pointer");
check("tap_action:none tira o cursor de mão",
  p(make({ entity: "binary_sensor.movimento_na_cozinha", tap_action: "none" }),
    "--mw-cursor") === "default");

hass.calls = [];
make({ entity: "binary_sensor.movimento_na_cozinha", tap_action: "toggle" })._run("toggle", true);
check("tap toggle chama homeassistant.toggle",
  hass.calls.length === 1 && hass.calls[0][1] === "toggle", JSON.stringify(hass.calls));

hass.calls = [];
make({ entity: "binary_sensor.sumido", lock_when_broken: true })._run("toggle", true);
check("lock_when_broken trava o tap do indisponível", hass.calls.length === 0);

// ---- caminho rápido e ponteiro --------------------------------------------
const fast = make({ entity: "binary_sensor.movimento_na_cozinha" });
let updates = 0;
const realUpdate = fast._update.bind(fast);
fast._update = () => { updates += 1; realUpdate(); };
hass.states["binary_sensor.outra_coisa"] = mkState("on");
fast.hass = hass;               // mudou OUTRA entidade
fast.hass = hass;
check("mudança de outra entidade não redesenha (caminho rápido)", updates === 0);
hass.states["binary_sensor.movimento_na_cozinha"] = mkState("off",
  { friendly_name: "MOVIMENTO NA COZINHA", device_class: "motion" });
fast.hass = hass;
check("mudança da própria entidade redesenha",
  updates === 1 && fast.getAttribute("mode") === "clear");
hass.states["binary_sensor.movimento_na_cozinha"] = mkState("on",
  { friendly_name: "MOVIMENTO NA COZINHA", device_class: "motion" });

const held = make({ entity: "binary_sensor.movimento_na_cozinha", tap_action: "toggle" });
hass.calls = [];
held.emit("pointerdown", { button: 0, timeStamp: 0, clientX: 5, clientY: 5 });
held.emit("pointerup", { timeStamp: 120, clientX: 6, clientY: 5, stopPropagation() {} });
check("pointer curto = tap", hass.calls.length === 1);
held.emit("pointerdown", { button: 0, timeStamp: 0, clientX: 5, clientY: 5 });
held.emit("pointerup", { timeStamp: 200, clientX: 90, clientY: 5, stopPropagation() {} });
check("arrastar não dispara ação", hass.calls.length === 1);
held.title = "";
held.emit("pointerenter", {});
check("tooltip é recalculado ao passar o mouse", /detectado há/.test(held.title), held.title);

console.log("editor:");
const ed = new reg["mw-occupancy-motion-element-editor"]();
ed.setConfig({ entity: "binary_sensor.movimento_na_cozinha" });
ed.hass = hass;
check("editor monta o ha-form",
  ed.children.length === 1 && ed.children[0].tagName === "HA-FORM");
check("editor mostra os padrões em vigor",
  ed._form.data.animation === "radar" && ed._form.data.size === "6%"
  && ed._form.data.plate === "none");
check("editor rotula em pt-BR",
  ed._form.computeLabel({ name: "elevation_detected" }) === "Elevação ao detectar");
const schema = JSON.stringify(ed._form.schema);
check("editor cobre entidade, animação, placa, elevação, cores e ações",
  ["entity", "animation", "plate", "elevation", "color_detected", "tap_action"]
    .every((k) => schema.includes(`"${k}"`)));
check("elemento oferece editor ao picture-elements",
  typeof reg["mw-occupancy-motion-element"].getConfigElement === "function"
  && reg["mw-occupancy-motion-element"].getConfigElement().tagName
    === "MW-OCCUPANCY-MOTION-ELEMENT-EDITOR");
check("stub config traz o type", reg["mw-occupancy-motion-element"]
  .getStubConfig().type === "custom:mw-occupancy-motion-element");

let threw = false;
try { new reg["mw-occupancy-motion-element"]().setConfig({}); } catch (e) { threw = true; }
check("setConfig sem entity falha", threw);

console.log(fails ? `\n${fails} verificação(ões) falharam` : "\ntudo ok");
process.exit(fails ? 1 : 0);
