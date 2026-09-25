#!/usr/bin/env node
// Placeholder that holds the `inwards` name on npm until the real package ships.
// Exit 2 for anything but --version, so a bump to this package fails loudly.
const message =
  "inwards 0.0.0 is an early placeholder, not the linter itself.\n" +
  "Inwards, an architecture linter for Python, has not been released yet.";
const version = process.argv.slice(2).join(" ") === "--version";
(version ? process.stdout : process.stderr).write(`${message}\n`);
process.exitCode = version ? 0 : 2;
