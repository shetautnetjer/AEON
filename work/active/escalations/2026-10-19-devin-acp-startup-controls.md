# Technical advice request — Devin ACP startup controls

Prepared by AYA, 2026-10-19, from public vendor contracts and sanitized local observations. Advice only; no account changes, code release or gate authority.

## Prompt for ChatGPT Pro
Devin CLI3000.11.92: I need a supported, task/session-local way to start ACP with no effective plugins, hooks, imported rules, or MCP integrations, and a native readback proving it. Do not suggest bypass mode, account/plugin removal, credential copies, alternate HOME, or equate callback policy with OS confinement.

Vendor docs say repo `.devin/config.json` can contain `forbiddenPlugins:["*"]`, but higher-authority required plugins override it; load-time blocking explicitly promises only skipped skills. In a new synthetic fixture, native `plugins list`/`plugins info` still enumerate8 installed plugins and no blocked/forbidder status. Info lists no hooks/rules/agents, but each plugin declares MCP; two also declare15skills total. The exact17-name MCP overlay is read back disabled. Plugin listing matches before/after, fixture bytes unchanged. No ACP session/prompt or selection was started after this missing-governance-readback negative. This is an evidence gap, not proof the wildcard is ineffective. One prior metadata-only ACP session exposed accept-edits/smart/ask/plan/bypass; no normal/auto configOptions value. Legacy modes/update payload was not retained. No effective prompting semantics is established.

Primary docs: https://docs.devin.ai/cli/extensibility/plugins/overview ; https://docs.devin.ai/cli/reference/permissions ; https://docs.devin.ai/cli/reference/commands ; https://docs.devin.ai/cli/changelog/stable ; https://docs.devin.ai/cli/reference/configuration/config-file . The config reference says only permissions/read_config_from/hooks are project settings, while plugin docs separately name repo governance—retain this documentation tension.

One question: what documented native control/readback (or exact source-inspection target if undocumented) can settle task-local all-component suppression and ACP all-write/all-exec prompting without weakening these boundaries? Separate supported facts, hypotheses and one smallest discriminating next check; cite decisive sources. If no source establishes it, say unknown rather than inventing a flag.

## Delivery state
Not sent at preparation. Browser Harness list-tabs attempt timed out after75s with Chrome remote-debugging permission required; no chat target handle, prompt submission or reply verified. Do not claim delivery or blindly resubmit. The supervisor's final update carries this prompt if no supported delivery succeeds. No private filesystem paths, credentials, account IDs or project data are part of the prompt above.
