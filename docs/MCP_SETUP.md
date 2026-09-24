# MCP setup

[`.mcp.json.example`](../.mcp.json.example) at the repo root lists the MCP servers of the recommended stack, with `${VAR}` expansion so no secret is ever committed. It includes **only servers whose install form is documented** in the stack research ([research/stack-final.md § mcpServers](research/stack-final.md)).

The ground rule: **MCP servers are for exploration and interactive work. Production runs from committed scripts** (`pnpm gen:*`, `blender -b -P`, `Spine.sh`, `tools/capture`), and every output gets a row in `art/manifest.json`. See [STACK](STACK.md) and [PIPELINE](PIPELINE.md).

## 1. Use it

```bash
cp .mcp.json.example .mcp.json      # then delete the entries you will not use
export MESHY_API_KEY=… TRIPO_API_KEY=… STAKE_DOCS_DIR=/abs/path/to/StakeEngine-docs   # see §4
claude                              # approve the project servers when prompted; /mcp to check and log in
```

- **Remove servers you don't use.** A `${VAR}` with no default that isn't set in your environment makes Claude Code refuse to parse the file. Optional local settings already use `${VAR:-default}`.
- **Windows:** stdio servers launched with `npx` need `"command": "cmd", "args": ["/c", "npx", …]`. The recommended workstation is Linux, so the file uses plain `npx`.

## 2. OAuth servers vs API-key servers

| Server | Auth | Add at | Works headless / in CI? | Optional? | Purpose |
|---|---|---|---|---|---|
| `scenario` | OAuth (interactive). Headless runs send an API-key header instead (check the header format in `scenario-labs/skills` setup.md) | project or user | Only with the API-key header | no | Style/character LoRA training (`?toolsets=full`), batch symbols, Ideogram V3 Transparent, upscaling |
| `higgsfield` | **OAuth only** | **user** (`--scope user`) | **No** | no (you asked for it) | Multi-model exploration, animatics; Nano Banana Pro = `nano_banana_2` on the CLI |
| `recraft` | **OAuth only** (MCP). Batch work uses REST + `RECRAFT_API_KEY` | **user** | No (use REST in scripts) | no | Style-locked SVG royals/UI/icons, logo vectorisation |
| `runpod` | OAuth (hosted). Or run `npx @runpod/mcp-server@latest add` with `RUNPOD_API_KEY` | user | Via the API-key form | **yes** | Burst GPU: parallel Blender renders, Wan-Alpha |
| `meshy` | API key `MESHY_API_KEY` (Pro plan or above) | project | Yes | no (Full AAA) | Meshy-7 image-to-3D candidates, remesh, rig/animate presets |
| `tripo` | API key `TRIPO_API_KEY` (`tsk_…`, prepaid credits from the developer console) | project | Yes | no (Full AAA) | Multiview-to-3D; rig/retarget are CLI-only |
| `comfy` | none (local) | project | On the workstation runner | **yes** | Local GPU hub for **allowlisted weights only** (Qwen-Image-2512/Edit-2511/Layered, BiRefNet, Wan) |
| `stake-docs` | none (local build) | project | Yes | no | Offline `search_docs` / `get_page` for approval rules |
| `playwright` | none | project | Yes | no | Exploratory driving of the dev build (production capture uses `tools/capture`) |
| `chrome-devtools` | none | project | Yes | no | Perf traces during big wins, mobile emulation, Android via adb |
| `browserstack` | `BROWSERSTACK_USERNAME` + `BROWSERSTACK_ACCESS_KEY` | project | Yes | **yes** | Real iOS/Android device runs |

**Why OAuth servers belong at user scope:**
- They log in to **your** vendor account, with its plan, credits and training-opt-out setting.
- Their tokens are per person and per machine, and they cannot run in `claude -p` or GitHub Actions.
- Add them once for yourself:

```bash
claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
claude mcp add --transport http --scope user recraft    https://mcp.recraft.ai/mcp
claude mcp add --transport http --scope user scenario   "https://mcp.scenario.com/mcp?toolsets=full"   # or keep it in the project file
# then inside Claude Code: /mcp -> pick the server -> Authenticate
```

If you keep them in the project file too, every teammate authenticates separately, and CI simply cannot use them. For the same reason, CI and nightly jobs use **API-key servers and plain SDK/CLI calls only**.

## 3. Prerequisites per server

```bash
# tripo: the MCP ships inside the CLI
npm i -g tripo-cli@0.5.1
# meshy: nothing to install (npx); optional CLI for scripts
npm i -g meshy-cli
# comfy (optional, workstation with GPU)
pip install comfy-mcp 'comfy-cli>=1.14.0' && comfy install
# stake-docs: build the official docs MCP from source
git clone https://github.com/StakeEngine/docs "$STAKE_DOCS_DIR" && cd "$STAKE_DOCS_DIR/mcp-server" && pnpm i && pnpm build
# playwright browsers (in this repo)
pnpm exec playwright install chromium
```

Research round 1 found the docs MCP in the `engineio/docs` repo. Round 2 uses `StakeEngine/docs`; use whichever resolves.

**Higgsfield specifics:**
- After authenticating, call the MCP tool **`select_workspace`** once. Generation fails silently until a workspace is selected.
- Open issues as of 2026-09-24:
  - [#76](https://github.com/higgsfield-ai/cli/issues/76): Claude Code's OAuth token exchange fails.
  - [#93](https://github.com/higgsfield-ai/cli/issues/93): `generate_image`/`generate_video` fail with `params: Invalid input`.
- If either bites, use one of:
  - the claude.ai / Desktop connector (Customize → Connectors → Add custom connector → `https://mcp.higgsfield.ai/mcp`);
  - the official CLI: `npm i -g @higgsfield/cli@1.1.26 && higgsfield auth login && higgsfield workspace set <id>`. On npm installs use `higgsfield …`, not `hf …`.
- Details: [art/bible/prompts/README.md § Route 1](../art/bible/prompts/README.md#route-1-higgsfield-mcp-or-cli).

## 4. Environment variables

| Variable | Used by | Where to get it |
|---|---|---|
| `MESHY_API_KEY` | meshy MCP / CLI | Meshy dashboard (Pro plan+) |
| `TRIPO_API_KEY` | tripo MCP / CLI | Tripo developer console (prepaid credits, separate from the web plan) |
| `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY` | browserstack MCP | BrowserStack Automate |
| `COMFY_BIN`, `COMFYUI_URL` | comfy MCP | Your ComfyUI install (defaults are in the file) |
| `STAKE_DOCS_DIR` | stake-docs MCP | The absolute path of your `StakeEngine/docs` clone |
| `SCENARIO_API_KEY` | Scenario headless header / REST | Scenario settings |
| `RECRAFT_API_KEY` | Recraft REST batches | Recraft API (a paid plan, or Recraft owns the outputs) |
| `RUNPOD_API_KEY` | RunPod local MCP / SDK | RunPod console |
| `HIGGSFIELD_API_KEY` = `<id>:<secret>` | `@higgsfield/cloud-cli` (`hf-api`) only; the MCP uses OAuth | cloud.higgsfield.ai |

The following are **not MCP**; they are used by the production scripts:
- Google Vertex credentials (Nano Banana Pro);
- `ELEVENLABS_API_KEY`;
- the Stability key;
- the BFL `x-key` (FLUX.1 Fill [pro]);
- `FAL_KEY` (hosted SAM 3 / Qwen-Image-Layered fallback);
- a Hugging Face token (gated `facebook/sam3`);
- `ANTHROPIC_API_KEY` (CI).

Set a **spend cap in every vendor dashboard** before creating keys.

## 5. Deliberately not in the file

| Tool | Why | Use instead |
|---|---|---|
| fal hosted MCP | The URL `https://mcp.fal.ai/mcp` is not confirmed in fal's own docs or the official registry | `pip install fal-client==1.0.3` in scripts |
| ElevenLabs hosted MCP | Its OAuth scopes do not include SFX or music | `@elevenlabs/elevenlabs-js` / `@elevenlabs/cli`; `/plugin marketplace add elevenlabs/plugin` for skill references |
| Rodin (Hyper3D) | Shipped as an official Claude Code **plugin**, not a server entry | `/plugin marketplace add DeemosTech/rodin3d-skills`, then `/plugin install rodin3d-skill@rodin3d-skills` (`HYPER3D_API_KEY`) |
| Blender MCP | Look-dev only, and it runs unsandboxed Python | Official Blender Lab MCP in its own venv, or `claude mcp add blender -e DISABLE_TELEMETRY=true -- uvx mcp-for-blender` with its **Hunyuan3D tool disabled**. Production = `blender -b -P`. |
| fxhoudinimcp | Only useful if you buy Houdini FX | `pip install fxhoudinimcp && python -m fxhoudinimcp install` |
| Community Spine MCPs | Wrong format (4.2/3.8), a cracked build in one README, PolyForm-NC ([denylist](../licenses/denylist.json)) | The official Spine CLI via scripts |
| Any OpenAI MCP/model | OpenAI's usage policy prohibits real-money gambling ([STACK](STACK.md#excluded-tools-and-why)) | Gemini 3.1 Pro as the second judge |

**Skills and plugins worth adding:**
- `npx skills add scenario-labs/skills`
- `/plugin marketplace add higgsfield-ai/skills` → `/plugin install higgsfield@higgsfield`
- optional: `/plugin marketplace add runpod/runpod-plugins-official`

## 6. Cloud sessions and CI

- **Anthropic cloud sessions** (4 vCPU, 16 GB, no GPU) block most AI vendor hosts on the default "Trusted" network. Set the environment's network to **Custom** and allowlist the API hosts you call. Research examples: `api.elevenlabs.io`, `api.stability.ai`, `api.meshy.ai`, `api.replicate.com`, plus your Google Vertex endpoint. Store API credentials in the environment. Connectors added in claude.ai bypass the allowlist.
- **GitHub Actions** (`anthropics/claude-code-action@v1`): `claude_args: --model claude-opus-5-5 --mcp-config .mcp.json --max-turns 30`, with API-key servers only. GPU jobs (Blender, Spine, ComfyUI) run on the self-hosted workstation runner (label `gpu`).
