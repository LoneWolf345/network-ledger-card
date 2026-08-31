# Network Ledger Card

An editorial, almanac-style internet & network health panel for Home Assistant — a companion to the [Almanac Weather Card](https://github.com/LoneWolf345/almanac-weather-card). Sand paper, serif figures, dotted-leader ledger rows.

## What it shows

- **Uptime & incident streak** — twin lead figures computed **live from Home Assistant's recorded history** of an Uptime Kuma WAN monitor. Honest by design: the fine print shows the actual minutes lost and the real measurement window; no fabricated nines.
- **Speeds on the ink band** — the eero network's own modem-side speed test (↓/↑ Mbps). If the WAN is down the band turns terracotta and says so.
- **LTE backup chip** — appears **only when your eero network has backup internet**; shows STANDBY or CARRYING THE HOUSE.
- **The Register** — data drawn today / month to date, total devices, round-trip latency rows, and optional per-person eero profile rows (✓ active / ✖ paused).
- **The Mesh** — eero nodes **auto-discovered** from the entity/device registries, each with a hand-drawn glyph matched to its model (PoE Gateway rack, Outdoor dome, PoE ceiling puck, indoor pebble), status dot, and client count. Router uptime included.
- **Distant Dependencies** — cloud services you rely on (Nabu Casa, Teslemetry, Anthropic…), deliberately separated: "not the wire's fault."
- **Tap anything** for its more-info/history dialog. Fully responsive (container queries; columns stack under 380px).

## Requirements

- [eero integration](https://github.com/schmittx/home-assistant-eero) (HACS) for network/mesh/usage entities.
- [Uptime Kuma](https://github.com/louislam/uptime-kuma) (e.g. the Home Assistant add-on) + the core **Uptime Kuma** integration for latency/status sensors.

## Installation (HACS)

1. HACS → Custom repositories → add this repo, category **Dashboard**
2. Install **Network Ledger Card**
3. Add to a dashboard:

```yaml
type: custom:network-ledger-card
prefix: robbins_dr              # your eero network's entity prefix
isp_name: Cox                   # text mark, or use isp_logo
isp_logo: /local/network-ledger/cox-logo.png   # optional image
wan_monitor: cox_first_hop      # Kuma monitor slug used for uptime history
latency:
  - { label: "Cox's door", monitor: cox_first_hop }
  - { label: "Wider internet", monitor: google_dns }
dependencies:
  - { label: "Nabu Casa", monitor: nabu_casa_remote }
  - { label: "Teslemetry", monitor: teslemetry_api }
  - { label: "Anthropic", monitor: anthropic_api }
profiles:
  - { name: James, entity: switch.james_devices_paused }
  - { name: Henry, entity: switch.henrys_devices_paused }
```

| Option | Default | Description |
|---|---|---|
| `prefix` | *(required)* | eero network entity prefix (`sensor.<prefix>_status` etc.) |
| `title` | `The Network Ledger` | Masthead title |
| `isp_name` / `isp_logo` | `ISP` / — | Text or image mark for your provider |
| `wan_monitor` | — | Kuma monitor slug; drives uptime, streak, and the down banner |
| `latency` | `[]` | `{label, monitor}` rows for the Register |
| `dependencies` | `[]` | `{label, monitor}` chips for the dependency strip |
| `profiles` | `[]` | `{name, entity}` eero profile pause switches |
| `history_days` | `30` | History window requested (bounded by your recorder retention) |

## Versioning

Home Assistant CalVer: `YYYY.M.PATCH`. Current: **2026.8.2**.
