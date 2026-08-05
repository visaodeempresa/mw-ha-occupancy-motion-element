/* Probe headless — instancia o elemento fora do navegador e confere o que
 * some quando alguém mexe: cor por estado, halo derivado (inclusive por
 * color-mix quando a cor é var()), placa, elevação com e sem placa, animação
 * só no detectado, ícones, geometria no host e o "unknown" de estado estranho.
 * Roda no CI e antes de qualquer push:  node tools/probe.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const mkStyle = () => {
  const s = {};
  s.setProperty = (k, v) => { s[k] = v; };
  return s;
};

const mkNode = () => {
  const n = { attrs: {}, style: mkStyle() };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  return n;
};

global.HTMLElement = class {
  constructor() { this.style = mkStyle(); this._listeners = {}; }
  attachShadow() {
    const node = mkNode();
    this.shadowRoot = { innerHTML: "", querySelector: () => node };
    return this.shadowRoot;
  }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  dispatchEvent() {}
};
const reg = {};
global.customElements = { define: (n, c) => (reg[n] = c), get: (n) => reg[n] };
global.window = {};
global.CustomEvent = class { constructor(t, d) { this.type = t; Object.assign(this, d); } };
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
console.info = () => {};

eval(fs.readFileSync(
  path.join(__dirname, "..", "dist", "mw-occupancy-motion-element.js"), "utf8"));

const now = new Date().toISOString();
const hass = {
  states: {
    "binary_sensor.movimento_na_cozinha": {
      state: "on", last_changed: now,
      attributes: { friendly_name: "MOVIMENTO NA COZINHA", device_class: "motion" },
    },
    "binary_sensor.movimento_na_sala": {
      state: "off", last_changed: now,
      attributes: { friendly_name: "Movimento na Sala", device_class: "motion" },
    },
    "binary_sensor.presenca_no_quarto": {
      state: "on", last_changed: now,
      attributes: { friendly_name: "Presença no Quarto", device_class: "occupancy" },
    },
    "binary_sensor.sumido": { state: "unavailable", attributes: {} },
    "binary_sensor.esquisito": { state: "banana", attributes: {} },
    "binary_sensor.com_icone": {
      state: "off", attributes: { icon: "mdi:radar" },
    },
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

console.log("elemento:");

// ---- detectado -------------------------------------------------------------
const on = make({ entity: "binary_sensor.movimento_na_cozinha" });
check("detectado usa a cor de presença",
  on.style["--mw-c"] === "var(--mw-presence-color, #ffa726)", on.style["--mw-c"]);
check("halo de cor var() sai por color-mix",
  /color-mix\(in srgb, var\(--mw-presence-color, #ffa726\) 70%, transparent\)/
    .test(on.style["--mw-glow"]), on.style["--mw-glow"]);
check("halo entra como drop-shadow no ícone",
  on.style["--mw-ico-filter"].startsWith("drop-shadow(0 0 1.1vh color-mix"),
  on.style["--mw-ico-filter"]);
check("detectado anima radar", on.className === "s-detected a-radar", on.className);
check("ícone padrão é mdi:motion-sensor", on._ico.attrs.icon === "mdi:motion-sensor");
check("tooltip traz estado e idade",
  /MOVIMENTO NA COZINHA · detectado há \d+s/.test(on.title), on.title);
check("sem placa, a placa some do layout",
  on.shadowRoot.innerHTML.includes(".plate{display:none"));
check("estrutura montada uma vez tem as 4 camadas",
  ["plate", "aura", "rings", "box"].every((k) => on.shadowRoot.innerHTML.includes(`class="${k}"`)));

// ---- livre -----------------------------------------------------------------
const off = make({ entity: "binary_sensor.movimento_na_sala" });
check("livre pinta cinza-azulado",
  off.style["--mw-c"] === "rgba(176, 190, 197, 0.55)", off.style["--mw-c"]);
check("livre não gasta halo", off.style["--mw-glow"] === "transparent");
check("livre não anima nada", off.className === "s-clear", off.className);
check("livre baixa a opacidade do ícone", off.style["--mw-op"] === "0.75");
check("livre mantém o mesmo ícone do detectado",
  off._ico.attrs.icon === "mdi:motion-sensor");

// ---- exceções --------------------------------------------------------------
const gone = make({ entity: "binary_sensor.sumido" });
check("indisponível usa mdi:cancel tomate",
  gone._ico.attrs.icon === "mdi:cancel"
  && gone.style["--mw-c"] === "rgba(255, 99, 71, 0.85)", gone.style["--mw-c"]);
const weird = make({ entity: "binary_sensor.esquisito" });
check("estado fora das listas vira desconhecido",
  weird._ico.attrs.icon === "mdi:crosshairs-question" && weird.className === "s-unknown");
const missing = make({ entity: "binary_sensor.nao_existe" });
check("entidade inexistente vira indisponível", missing.className === "s-unavailable");

// ---- ícones ----------------------------------------------------------------
const own = make({ entity: "binary_sensor.com_icone" });
check("ícone da própria entidade é respeitado", own._ico.attrs.icon === "mdi:radar");
const auto = make({ entity: "binary_sensor.presenca_no_quarto", icon_set: "auto" });
check("icon_set:auto lê o device_class occupancy",
  auto._ico.attrs.icon === "mdi:home-account", auto._ico.attrs.icon);
const setOff = make({ entity: "binary_sensor.movimento_na_sala", icon_set: "motion" });
check("icon_set:motion troca o ícone do livre",
  setOff._ico.attrs.icon === "mdi:motion-sensor-off");
const forced = make({ entity: "binary_sensor.sumido", icon: "mdi:ghost" });
check("`icon` manda em todos os estados", forced._ico.attrs.icon === "mdi:ghost");

// ---- placa, elevação e sombra ---------------------------------------------
const plate = make({
  entity: "binary_sensor.movimento_na_sala", plate: "circle", elevation: 3, ring: 2,
});
check("placa deriva a cor do estado com alfa 0.16",
  plate.style["--mw-plate"] === "rgba(176, 190, 197, 0.16)", plate.style["--mw-plate"]);
check("com placa a elevação vira box-shadow",
  plate.style["--mw-elev"].includes("0 4px 8px rgba(0,0,0,0.30)"), plate.style["--mw-elev"]);
check("com placa o ícone não ganha drop-shadow de elevação",
  plate.style["--mw-ico-filter"] === "none", plate.style["--mw-ico-filter"]);
check("borda da placa entra no CSS",
  plate.shadowRoot.innerHTML.includes("border:2px solid var(--mw-ring)"));

const flat = make({ entity: "binary_sensor.movimento_na_sala", elevation: 2 });
check("sem placa a elevação vira drop-shadow no ícone",
  flat.style["--mw-ico-filter"] === "drop-shadow(0 2px 2px rgba(0,0,0,0.38))",
  flat.style["--mw-ico-filter"]);
check("sem placa não há box-shadow", flat.style["--mw-elev"] === "none");

const tinted = make({
  entity: "binary_sensor.movimento_na_sala", plate: "rounded",
  elevation: 1, shadow_color: "#102030",
});
check("shadow_color tinge a sombra preservando o alfa",
  tinted.style["--mw-elev"] === "0 1px 2px rgba(16,32,48,0.30), 0 1px 3px rgba(16,32,48,0.18)",
  tinted.style["--mw-elev"]);
check("plate rounded usa o raio configurado",
  tinted.shadowRoot.innerHTML.includes("border-radius:26%"));

const raw = make({
  entity: "binary_sensor.movimento_na_sala", plate: "square", shadow: "0 0 9px red",
});
check("`shadow` cru vence a elevação", raw.style["--mw-elev"] === "0 0 9px red");

const elevOn = make({
  entity: "binary_sensor.movimento_na_cozinha", plate: "circle",
  elevation: 1, elevation_detected: 4,
});
check("elevation_detected sobe a placa só quando detecta",
  elevOn.style["--mw-elev"].includes("0 8px 16px"), elevOn.style["--mw-elev"]);

// ---- animação --------------------------------------------------------------
const pulse = make({ entity: "binary_sensor.movimento_na_cozinha", animation: "pulse" });
check("animation:pulse marca a classe", pulse.className.includes("a-pulse"));
const always = make({
  entity: "binary_sensor.movimento_na_sala", animation: "beacon", animation_when: "always",
});
check("animation_when:always anima também no livre", always.className.includes("a-beacon"));
const never = make({
  entity: "binary_sensor.movimento_na_cozinha", animation_when: "never",
});
check("animation_when:never não anima nada", never.className === "s-detected");
const noneAnim = make({ entity: "binary_sensor.movimento_na_cozinha", animation: "none" });
check("animation:none não anima nada", noneAnim.className === "s-detected");
check("prefers-reduced-motion está no CSS por padrão",
  on.shadowRoot.innerHTML.includes("prefers-reduced-motion"));
const noRM = make({ entity: "binary_sensor.movimento_na_cozinha", reduced_motion: false });
check("reduced_motion:false remove o bloco",
  !noRM.shadowRoot.innerHTML.includes("prefers-reduced-motion"));
const oneRing = make({ entity: "binary_sensor.movimento_na_cozinha", rings: 1 });
check("rings:1 monta um anel só",
  (oneRing.shadowRoot.innerHTML.match(/<i><\/i>/g) || []).length === 1);
check("velocidade da animação vira variável CSS",
  on.shadowRoot.innerHTML.includes("--mw-spd:2.4s"));
check("fade de esfriamento vira variável CSS",
  on.shadowRoot.innerHTML.includes("--mw-fade:0.7s"));

// ---- geometria -------------------------------------------------------------
const geo = make({ entity: "binary_sensor.movimento_na_cozinha", left: "35.5%", top: "14%" });
check("geometria vai para o host",
  geo.style.left === "35.5%" && geo.style.top === "14%"
  && geo.style.width === "6vh" && geo.style.height === "6vh", JSON.stringify(geo.style));
check("sem scale/rotate o transform do picture-elements fica intacto",
  geo.style.transform === undefined);
const scaled = make({ entity: "binary_sensor.movimento_na_cozinha", scale: 0.6, rotate: 30 });
check("scale/rotate compõem com o translate",
  scaled.style.transform === "translate(-50%, -50%) rotate(30deg) scale(0.6)",
  scaled.style.transform);
const noGeo = make({ entity: "binary_sensor.movimento_na_cozinha", size: "" });
check("sem size na config o host não é tocado (vale o `style:` do YAML)",
  noGeo.style.width === undefined && noGeo.style.left === undefined);

// ---- estado, visibilidade e ações -----------------------------------------
const inv = make({ entity: "binary_sensor.movimento_na_cozinha", invert: true });
check("invert:true troca detectado por livre", inv.className === "s-clear");
const hide = make({ entity: "binary_sensor.movimento_na_sala", hide_clear: true });
check("hide_clear some com o elemento", hide.className.includes("is-hidden"));
check("tap padrão é more-info → cursor de mão", on.style.cursor === "pointer");
const mute = make({ entity: "binary_sensor.movimento_na_cozinha", tap_action: "none" });
check("tap_action:none tira o cursor de mão", mute.style.cursor === "default");

hass.calls = [];
make({ entity: "binary_sensor.movimento_na_cozinha", tap_action: "toggle" })
  ._run("toggle", true);
check("tap toggle chama homeassistant.toggle",
  hass.calls.length === 1 && hass.calls[0][1] === "toggle", JSON.stringify(hass.calls));

hass.calls = [];
const locked = make({ entity: "binary_sensor.sumido", lock_when_broken: true });
locked._run("toggle", true);
check("lock_when_broken trava o tap do indisponível", hass.calls.length === 0);

const still = make({ entity: "binary_sensor.movimento_na_sala" });
still._ico.attrs.icon = "TOCADO";
still.hass = hass;
check("mesmo estado não reescreve o ícone", still._ico.attrs.icon === "TOCADO");
hass.states["binary_sensor.movimento_na_sala"] = { state: "on", attributes: {} };
still.hass = hass;
check("estado novo redesenha", still.className.includes("s-detected"));
hass.states["binary_sensor.movimento_na_sala"] = {
  state: "off", last_changed: now,
  attributes: { friendly_name: "Movimento na Sala", device_class: "motion" } };

let threw = false;
try { new reg["mw-occupancy-motion-element"]().setConfig({}); } catch (e) { threw = true; }
check("setConfig sem entity falha", threw);

console.log(fails ? `\n${fails} verificação(ões) falharam` : "\ntudo ok");
process.exit(fails ? 1 : 0);
