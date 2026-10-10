#!/usr/bin/env bun
import { PROTOCOL_VERSION } from "@fota/protocol";

interface Command {
  summary: string;
  phase: string;
  run?: (args: string[]) => Promise<number>;
}

const commands: Record<string, Command> = {
  init: { summary: "Add fota config, signing key and updater to a Flutter app", phase: "5" },
  release: { summary: "Build a release with the fota engine and register it", phase: "1" },
  patch: { summary: "Build a Dart-only patch against an existing release", phase: "1" },
  preview: { summary: "Install a patch on a local device before publishing", phase: "5" },
  rollback: { summary: "Pull a patch from all devices", phase: "2" },
  doctor: { summary: "Check toolchain, engine version and signing keys", phase: "5" },
};

function usage() {
  const width = Math.max(...Object.keys(commands).map((c) => c.length));
  const lines = Object.entries(commands).map(
    ([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`,
  );
  return `fota: Flutter over-the-air code push (protocol v${PROTOCOL_VERSION})

Usage: fota <command> [options]

Commands:
${lines.join("\n")}
`;
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "-h" || name === "--help" || name === "help") {
    console.log(usage());
    return 0;
  }

  const command = commands[name];
  if (!command) {
    console.error(`Unknown command: ${name}\n\n${usage()}`);
    return 64;
  }
  if (!command.run) {
    console.error(`\`fota ${name}\` is not implemented yet (roadmap phase ${command.phase}).`);
    return 1;
  }
  return command.run(rest);
}

process.exit(await main(Bun.argv.slice(2)));
