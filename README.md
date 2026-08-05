# MW Occupancy / Motion Element

Elemento de **picture-elements** do Home Assistant: o **sensor de movimento /
presença** na planta. Troca o `type: state-icon` cru — que só sabe pintar o
ícone — por um elemento com **halo, placa, elevação, animação e esfriamento**,
tudo opcional, tudo desligável.

```yaml
type: custom:mw-occupancy-motion-element
entity: binary_sensor.movimento_na_cozinha
name: 🟨👤 SENSOR DE MOVIMENTO NA COZINHA
left: 35.5%
top: 14%
color_detected: var(--cor-presenca-cozinha)
```

> É um **elemento**, não um card: só funciona dentro de
> `type: picture-elements` (na lista `elements:`).

Irmão do [MW Light Element](https://github.com/visaodeempresa/mw-ha-light-element)
e do [MW Door / Window Element](https://github.com/visaodeempresa/mw-ha-door-window-element),
que cuidam das luzes e das portas da mesma planta.

> **v1.0** — reescrita para velocidade e com **editor visual**. A geometria
> agora é **proporcional**: `size` em % da planta, e as medidas internas em %
> do lado do elemento. Veja [Voltando ao visual da v0.1.0](#voltando-ao-visual-da-v010)
> se você quer as medidas fixas de antes.

## Instalação (HACS)

HACS → Dashboard → ⋮ → *Custom repositories* →
`https://github.com/visaodeempresa/mw-ha-occupancy-motion-element` → tipo
**Dashboard** → Download. Depois, hard refresh no navegador.

## Editor visual

O elemento expõe `getConfigElement()`: no editor do picture-elements ele
aparece como **formulário em pt-BR** — entidade, posição, animação, placa,
elevação, cores, ícones e ações — em vez de YAML cru. Onde a versão do HA não
suportar, o YAML continua valendo (nada é obrigatório vir do editor).

## Leveza não é detalhe, é requisito

Uma planta tem uma dúzia desses. Cinco decisões seguram o custo:

1. **A árvore do shadow DOM é montada uma vez.** Estado que muda só troca
   *custom properties* e atributos do host — nada de `innerHTML`, nada de CSS
   re-parseado, nada de `<ha-icon>` recriado a cada evento do sensor.
2. **Uma folha de estilo para todas as instâncias** (`adoptedStyleSheets`):
   12 sensores na planta = 1 CSS parseado.
3. **O `set hass` sai em O(1)** quando a mudança é de outra entidade — e o HA
   empurra `hass` a **cada** mudança de **qualquer** entidade. É aqui que uma
   planta cheia engasga.
4. **As animações mexem só em `transform` e `opacity`** (trabalho de
   compositor, sem layout nem repaint) e, por padrão, **só rodam no estado
   detectado**: com a casa parada, a planta não gasta um frame.
5. **`prefers-reduced-motion` é respeitado** por padrão — quem pediu menos
   movimento no sistema não recebe animação nenhuma (`reduced_motion: false`
   se você quiser animar assim mesmo).

O único ajuste caro da casa é `plate_frost` (vidro fosco = `backdrop-filter`).
Use em um punhado de pontos, não em todos.

## Estados

| Modo | Estados da entidade |
|---|---|
| `detected` | `on`, `detected`, `home`, `open`, `active`, `motion`, `occupied` |
| `clear` | `off`, `clear`, `not_home`, `closed`, `idle`, `standby`, `away` |
| `unavailable` | `unavailable` ou entidade que não existe |
| `unknown` | `unknown`, vazio, ou **qualquer estado fora das listas** |

Todo par de opções `*_detected` / `*_clear` / `*_unavailable` / `*_unknown`
segue essa tabela.

## Posicionamento proporcional

O host do elemento **é a caixa**, quadrada por `aspect-ratio`. Dá para
posicionar de dois jeitos:

- pela **config** (`left`, `top`, `size`, `scale`, `rotate`) — legível e fácil
  de gerar por script;
- pelo **`style:`** do picture-elements, como qualquer elemento nativo (nesse
  caso zere `size`, senão a config vence).

`size` em **%** é da largura da planta, então o sensor encolhe e cresce junto
com ela. Tudo que é medida interna (ícone, halo, borda, elevação, anéis do
radar) é resolvido em `cqmin` — % do lado do próprio elemento. Onde a opção
aceitar `%`, é isso que acontece; `px`, `vh` e afins continuam valendo se você
quiser tamanho fixo.

## Voltando ao visual da v0.1.0

A v0.1.0 media tudo em `vh` (fixo na altura da tela); a v1.0 mede em % da
planta e do próprio elemento. As proporções internas são as mesmas — ícone a
60% e halo a 18% do lado da caixa —, o que muda é o **tamanho da caixa**, que
agora acompanha a planta em vez da janela.

Se você quer exatamente as medidas fixas de antes, elas continuam válidas:
qualquer opção de medida aceita `vh`, `px`, `em` ou o que você escrever.

```yaml
size: 6vh
icon_size: 3.6vh
glow_blur: 1.1vh
radar_width: 2px
```

## Opções

### Entidade

| Opção | Padrão | O que faz |
|---|---|---|
| `entity` | — | **obrigatória** |
| `name` | `""` | tooltip; vazio = `friendly_name` |
| `invert` | `false` | entidade invertida (`on` = livre) |
| `show_age` | `true` | tooltip ganha `· detectado há 3 min` |

### Geometria

| Opção | Padrão | O que faz |
|---|---|---|
| `left` / `top` | `""` | posição na planta |
| `size` | `6%` | lado da caixa, em % da largura da planta |
| `scale` / `rotate` | `null` | escala / rotação do conjunto |

### Ícone

| Opção | Padrão | O que faz |
|---|---|---|
| `icon` | `""` | força o ícone em **todos** os estados |
| `icon_set` | `""` | `auto` (pelo `device_class`), `motion`, `occupancy`, `presence`, `moving` — troca o ícone entre detectado e livre |
| `icon_detected` / `icon_clear` | `""` | ícone por estado; vazio = ícone da entidade, senão `icon_fallback` |
| `icon_unavailable` | `mdi:cancel` | |
| `icon_unknown` | `mdi:crosshairs-question` | |
| `icon_fallback` | `mdi:motion-sensor` | |
| `icon_size` | `""` | vazio = 60% do lado da caixa |
| `icon_scale` | `1` | |
| `icon_opacity_*` | `1` / `0.75` / `0.9` / `0.9` | opacidade por estado |
| `icon_offset_y` | `0` | desloca o ícone dentro da caixa |
| `icon_upright` | `false` | desfaz o `rotate` só no ícone |

### Cores

| Opção | Padrão |
|---|---|
| `color_detected` | `var(--mw-presence-color, #ffa726)` |
| `color_clear` | `rgba(176, 190, 197, 0.55)` |
| `color_unavailable` / `color_unknown` | `rgba(255, 99, 71, 0.85)` |

Aceitam `var(--...)`, `#hex`, `rgb()`, `rgba()` e nome de cor. Tudo que é
derivado dessa cor (halo, placa, borda) sai por `rgba()` quando dá, e por
`color-mix()` quando a cor é uma variável de tema.

### Efeito e halo

`effect` é o atalho que ajusta o halo inteiro de uma vez: `glow` (padrão),
`neon` (halo 1,7×), `soft` (0,65×) e `flat` (sem halo). O halo em si é
`drop-shadow` **no ícone** — segue o desenho, não a caixa.

| Opção | Padrão | O que faz |
|---|---|---|
| `effect` | `glow` | `glow`, `neon`, `soft`, `flat` |
| `glow` | `true` | liga o halo |
| `glow_when` | `detected` | `detected`, `always`, `never` |
| `glow_blur` | `18%` | % do lado da caixa |
| `glow_opacity` | `0.7` | alfa do halo derivado da cor do estado |
| `glow_color_*` | `""` | cor crua por estado (vence o derivado) |

### Placa

A superfície por baixo do ícone — é ela que recebe a elevação.

| Opção | Padrão | O que faz |
|---|---|---|
| `plate` | `none` | `none`, `circle`, `rounded`, `square` |
| `plate_radius` | `26%` | só no `rounded` |
| `plate_opacity` | `0.16` | alfa da placa derivada da cor do estado |
| `plate_color_*` | `""` | cor crua por estado |
| `plate_frost` | `0` | px de vidro fosco (`backdrop-filter`) — **caro** |
| `ring` | `0` | espessura da borda da placa (`"6%"` ou `"2px"`) |
| `ring_opacity` | `0.55` | |
| `ring_color_*` | `""` | |

### Elevação e sombra

| Opção | Padrão | O que faz |
|---|---|---|
| `elevation` | `0` | 0–5. **Com placa** vira `box-shadow`; **sem placa**, `drop-shadow` no contorno do ícone |
| `elevation_detected` | `null` | degrau só no detectado — o ícone "levanta" quando alguém passa |
| `shadow` | `""` | CSS cru de `box-shadow` (vence a elevação) |
| `icon_shadow` | `""` | CSS cru de `filter` (vence a elevação, sem placa) |
| `shadow_color` | `""` | tinge as sombras prontas preservando os alfas |

### Animação

| Opção | Padrão | O que faz |
|---|---|---|
| `animation` | `radar` | `none`, `pulse`, `radar`, `beacon`, `blink` |
| `animation_when` | `detected` | `detected`, `always`, `never` |
| `animation_speed` | `2.4` | segundos por ciclo |
| `rings` | `2` | anéis do radar (1 ou 2) |
| `ring_spread` | `1.75` | até onde o anel cresce |
| `radar_width` | `4%` | espessura do anel do radar |
| `reduced_motion` | `true` | respeita `prefers-reduced-motion` |
| `fade` | `0.7` | segundos de esfriamento — a cor esvai em vez de estalar |

- **`radar`** — anéis saindo do ícone, defasados; é o "alguém passou aqui".
- **`pulse`** — o ícone respira (só `transform`, o mais barato de todos).
- **`beacon`** — uma auréola radial pulsando por trás do ícone.
- **`blink`** — piscada dupla curta, para alarme.

### Visibilidade e ações

| Opção | Padrão | O que faz |
|---|---|---|
| `hide_detected` / `hide_clear` / `hide_unavailable` / `hide_unknown` | `false` | some com o elemento naquele estado |
| `tap_action` | `more-info` | `none`, `toggle`, `more-info`, `navigate`, `url`, `call-service` |
| `hold_action` | `more-info` | |
| `double_tap_action` | `none` | |
| `lock_when_broken` | `false` | `true` = indisponível/desconhecido não aceita tap |
| `haptic` | `true` | vibração no toque (celular) |
| `navigation_path` / `url_path` / `service` / `service_data` | `""` | alvos das ações |

## Verificação

```bash
node --check dist/mw-occupancy-motion-element.js && node tools/probe.js
```

O probe instancia o elemento fora do navegador (shim mínimo de DOM) e confere
72 pontos: modo por estado, cores/halo/placa em custom properties, elevação com
e sem placa, animação só no detectado, ícones, geometria proporcional, o
caminho rápido do `set hass`, o ponteiro e o editor. Roda no CI e na release
automática.

## Pendente

Publicado direto na `main` a pedido do dono (economia de token). Depois da
validação na tela vêm: fluxo `feature → develop → release → main`,
`PLANO.md` / `HISTORICO.md`, skill do repositório e suporte no MW Floorplan
Studio para gerar esses elementos.

## Licença

MIT © MAYCON WILLIAN OLIVEIRA
