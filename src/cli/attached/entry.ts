import { runAttachSubcommand } from "@/cli/subcommands/attach";

if (import.meta.main) {
  process.exitCode = await runAttachSubcommand(process.argv.slice(2));
}
