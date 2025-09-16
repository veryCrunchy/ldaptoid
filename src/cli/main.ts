#!/usr/bin/env -S deno run -A
/**
 * LDAPtOID CLI Entry (skeleton)
 * Phase 1: Placeholder wiring; real server logic added after tests.
 */

import { parse } from 'std/flags/mod.ts';

interface CliOptions {
  listFlags?: boolean;
  help?: boolean;
  version?: boolean;
}

const VERSION = '0.1.0-dev';

function printHelp() {
  console.log(`LDAPtOID CLI
Usage: deno run -A src/cli/main.ts [options]

Options:
  --list-flags        Show active feature flags (placeholder)
  --version           Print version
  -h, --help          Show help
`);
}

function loadFeatureFlags(): string[] {
  const env = Deno.env.get('LDAPTOID_FEATURES');
  if (!env) return [];
  return env.split(',').map(f => f.trim()).filter(Boolean).sort();
}

function main() {
  const args = parse(Deno.args, {
    boolean: ['list-flags', 'help', 'version'],
    alias: { h: 'help' },
  }) as CliOptions & Record<string, unknown>;

  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }
  if (args['list-flags']) {
    const flags = loadFeatureFlags();
    if (flags.length === 0) {
      console.log('No feature flags enabled.');
    } else {
      console.log('Active feature flags:');
      for (const f of flags) console.log(' -', f);
    }
    return;
  }

  console.log('[ldaptoid] Placeholder CLI – server start not yet implemented.');
}

if (import.meta.main) {
  main();
}
