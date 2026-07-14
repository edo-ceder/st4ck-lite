#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseRef = process.env.ST4CK_LITE_BASE_REF ?? "origin/main";
const manifestPath = "st4ck/.claude-plugin/plugin.json";

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const parse = (relativePath) => JSON.parse(read(relativePath));

const marketplace = parse(".claude-plugin/marketplace.json");
const manifest = parse(manifestPath);
const browseCommand = read("st4ck/commands/browse.md");
const claudeSkill = read("st4ck/skills/qa-record-test/SKILL.md");
const codexSkill = read("codex/skills/st4ck-browse/SKILL.md");
const readme = read("README.md");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function requireBaseRef(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `base ref ${ref} is unavailable; fetch it or rerun with ST4CK_LITE_BASE_REF=<existing-ref>`,
    );
  }
}

function parseSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return { core: match.slice(1, 4).map(Number), prerelease };
}

function isGreaterVersion(current, base) {
  const left = parseSemver(current);
  const right = parseSemver(base);
  check(left && right, `release versions must be SemVer (current ${current}, base ${base})`);

  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] > right.core[index];
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length > 0 && left.prerelease.length === 0;
  }

  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return b === undefined;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) > Number(b);
    if (aNumeric !== bNumeric) return !aNumeric;
    return a > b;
  }
  return false;
}

function validateFrontmatter(text, label) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  check(match, `${label} must start with YAML frontmatter`);
  check(!/[\t\r]/.test(match[1]), `${label} frontmatter must use simple LF-delimited YAML`);

  const entries = new Map();
  for (const line of match[1].split("\n")) {
    const field = /^([a-z][a-z0-9_-]*):\s*(.+)$/.exec(line);
    check(field, `${label} frontmatter uses an unsupported YAML shape: ${line}`);
    check(!entries.has(field[1]), `${label} frontmatter repeats ${field[1]}`);
    entries.set(field[1], field[2]);
  }

  const name = entries.get("name");
  const description = entries.get("description");
  check(name && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
    `${label} frontmatter must declare a kebab-case name`);
  check(description?.startsWith('"') && description.endsWith('"'),
    `${label} description must be one JSON-compatible quoted YAML scalar`);
  try {
    const parsedDescription = JSON.parse(description);
    check(typeof parsedDescription === "string" && parsedDescription.trim().length > 0,
      `${label} description must be a non-empty string`);
  } catch (error) {
    throw new Error(`${label} description is not a valid quoted YAML scalar: ${error.message}`);
  }
}

const browseCommandStart = /^(?:\$\s*)?(?:(?:npx(?:\s+(?:-y|--yes))?\s+st4ck(?:@[^\s]+)?)|st4ck)\s+browse\b/;

function extractBrowseCommands(text) {
  const lines = text.split("\n");
  const commands = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    // Outside a fence, only a command-start line is executable guidance.
    // Inside one, also accept the conventional "$ " shell-prompt prefix.
    const candidate = inFence ? trimmed.replace(/^\$\s*/, "") : trimmed;
    if (!browseCommandStart.test(candidate)) continue;

    let command = candidate;
    while (/\\\s*$/.test(command) && index + 1 < lines.length) {
      command = command.replace(/\\\s*$/, " ");
      index += 1;
      command += lines[index].trim();
    }
    commands.push(command);
  }

  return commands;
}

function shellTokens(command, label) {
  const tokens = [];
  let value = "";
  let tokenStarted = false;
  let quote = null;
  let expandableSegment = "";
  let mayExpand = false;

  const flushExpandableSegment = () => {
    if (/\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!_-]|\{|\()/.test(expandableSegment)
      || /`/.test(expandableSegment)
      || /%[^%]+%/.test(expandableSegment)) {
      mayExpand = true;
    }
    expandableSegment = "";
  };

  const pushToken = () => {
    if (!tokenStarted) return;
    flushExpandableSegment();
    tokens.push({ value, mayExpand });
    value = "";
    tokenStarted = false;
    mayExpand = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        // Preserve backslashes so path.win32 can recognize quoted Windows
        // drive and UNC paths while tracking double-quoted expansion syntax.
        value += character;
        if (quote === '"') expandableSegment += character;
      }
      if (!quote) flushExpandableSegment();
      tokenStarted = true;
      continue;
    }

    if (character === "#" && !tokenStarted) {
      // An unquoted # at a shell token boundary starts an inline comment.
      break;
    } else if (character === "'" || character === '"') {
      flushExpandableSegment();
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      pushToken();
    } else {
      if (!tokenStarted && character === "~") mayExpand = true;
      value += character;
      expandableSegment += character;
      tokenStarted = true;
    }
  }

  check(!quote, `${label} contains an unterminated quoted Browse command: ${command}`);
  pushToken();
  return tokens;
}

function commandFlagValues(tokens, flag, label, command) {
  const values = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === flag) {
      const valueToken = tokens[index + 1];
      check(valueToken !== undefined && valueToken.value.length > 0,
        `${label} contains ${flag} without a path value: ${command}`);
      check(!valueToken.value.startsWith("--") || /[./\\]/.test(valueToken.value.slice(2)),
        `${label} contains ${flag} without a path value: ${command}`);
      values.push(valueToken);
      index += 1;
    } else if (tokens[index].value.startsWith(`${flag}=`)) {
      const value = tokens[index].value.slice(flag.length + 1);
      check(value.length > 0, `${label} contains ${flag}= without a path value: ${command}`);
      values.push({ value, mayExpand: tokens[index].mayExpand });
    }
  }
  return values;
}

function escapesDefaultRepositoryRoot({ value, mayExpand }) {
  if (mayExpand) return true;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return true;
  if (/^[A-Za-z]:/.test(value)) return true;
  let depth = 0;
  for (const component of value.split(/[\\/]+/)) {
    if (!component || component === ".") continue;
    if (component === "..") {
      if (depth === 0) return true;
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return false;
}

function markdownFiles(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(relativePath));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(relativePath);
  }
  return files;
}

const standardLocatorOps = new Set([
  "click", "fill", "select", "check_box", "hover", "upload", "screenshot",
  "wait_until", "locate", "get-text", "assert-contains", "scroll",
  "click_native", "bubble_click",
]);

function validateBrowseSafety(surfaceName, surface) {
  for (const command of extractBrowseCommands(surface)) {
    const tokens = shellTokens(command, surfaceName);
    const browseIndex = tokens.findIndex((token) => token.value === "browse");
    const op = tokens[browseIndex + 1]?.value;
    check(browseIndex >= 0,
      `${surfaceName} contains a malformed Browse command: ${command}`);
    if (!op) continue;
    check(!/(?:^|\s)--by(?=\s|=|`)/.test(command),
      `${surfaceName} contains deprecated --by locator guidance: ${command}`);
    check(!/(?:^|\s)--quiet(?=\s|$|`)/.test(command),
      `${surfaceName} teaches unsupported --quiet; use --format quiet: ${command}`);
    if (standardLocatorOps.has(op)) {
      check(!/(?:^|\s)--value(?=\s|=|`)/.test(command),
        `${surfaceName} contains deprecated --value locator guidance: ${command}`);
    }
    if (op === "assert-contains") {
      check(!/(?:^|\s)--text\b/.test(command),
        `${surfaceName} teaches invalid assert-contains --text syntax: ${command}`);
    }
    if (op === "bubble_fill" || op === "bubble_select") {
      check(!/(?:^|\s)(?:--locator-by|--locator-value|--text|--option-label)\b/.test(command),
        `${surfaceName} teaches invalid ${op} flags: ${command}`);
    }
    const pathFlags = op === "screenshot"
      ? ["--out"]
      : op === "upload"
        ? ["--file"]
        : [];
    for (const flag of pathFlags) {
      for (const valueToken of commandFlagValues(tokens, flag, surfaceName, command)) {
        check(!escapesDefaultRepositoryRoot(valueToken),
          `${surfaceName} teaches a ${op} ${flag} path outside the default allowed repository root: ${valueToken.value}`);
      }
    }
  }

  check(!/\bxpath\b/i.test(surface),
    `${surfaceName} lists unsupported xpath locators`);
  check(!/(?:fix|use)[^\n]{0,80}(?:session-level\s+)?--platform/i.test(surface),
    `${surfaceName} presents launch --platform as today's reactive-UI fix`);
  check(!/\$SB_TOKEN|browse launch[^\n]*--local-storage|--local-storage[^\n]*sb-[^\n]*auth-token/i.test(surface),
    `${surfaceName} passes or recommends passing an auth token in process arguments`);
  check(!/don't author components|component layer[^.\n]*(?:paid|full)/i.test(surface),
    `${surfaceName} incorrectly makes all component authoring paid-only`);
}

function expectValidationFailure(label, surface, expectedMessage) {
  let failure;
  try {
    validateBrowseSafety(label, surface);
  } catch (error) {
    failure = error;
  }
  check(failure instanceof Error && expectedMessage.test(failure.message),
    `${label} self-test did not fail as expected`);
}

function runValidatorSelfTests() {
  const extractionFixture = [
    "Prose mentioning `npx st4ck@latest browse click --by text` is not a command.",
    "```bash",
    "npx -y st4ck@latest browse screenshot \\",
    "  --out \"artifacts/page shot.png\"",
    "$ st4ck browse upload --file 'fixtures/photo one.jpg'",
    "```",
    "st4ck browse screenshot --out=artifacts/summary.png",
  ].join("\n");
  const extracted = extractBrowseCommands(extractionFixture);
  check(extracted.length === 3,
    `Browse command extraction self-test expected 3 commands, got ${extracted.length}`);
  check(extracted[0].includes('--out "artifacts/page shot.png"'),
    "Browse command extraction self-test did not join a continued command");
  validateBrowseSafety("repository-relative path fixture", extractionFixture);
  validateBrowseSafety(
    "dash-prefixed relative filename fixture",
    "st4ck browse screenshot --out --trace.png",
  );
  validateBrowseSafety(
    "single-quoted literal filename fixture",
    "st4ck browse upload --file 'fixtures/price$1.png'",
  );

  expectValidationFailure(
    "missing screenshot path fixture",
    "st4ck browse screenshot --out --full-page",
    /without a path value/,
  );
  expectValidationFailure(
    "fenced npx locator fixture",
    "```bash\nnpx st4ck@latest browse click --by role --value button\n```",
    /deprecated --by locator guidance/,
  );
  expectValidationFailure(
    "bare locator fixture",
    "st4ck browse click --by role --value button",
    /deprecated --by locator guidance/,
  );
  expectValidationFailure(
    "POSIX screenshot fixture",
    "```bash\nnpx st4ck@latest browse screenshot --out \"/var/tmp/page.png\"\n```",
    /screenshot --out path outside/,
  );
  expectValidationFailure(
    "Windows screenshot fixture",
    String.raw`st4ck browse screenshot --out="C:\Users\tester\page.png"`,
    /screenshot --out path outside/,
  );
  expectValidationFailure(
    "Windows UNC upload fixture",
    String.raw`st4ck browse upload --file '\\server\share\fixture.png'`,
    /upload --file path outside/,
  );
  expectValidationFailure(
    "parent traversal upload fixture",
    "st4ck browse upload --file ../../outside/fixture.png",
    /upload --file path outside/,
  );
  expectValidationFailure(
    "tilde screenshot fixture",
    "st4ck browse screenshot --out ~/page.png",
    /screenshot --out path outside/,
  );
  expectValidationFailure(
    "environment upload fixture",
    "st4ck browse upload --file $HOME/fixture.png",
    /upload --file path outside/,
  );
  expectValidationFailure(
    "Windows environment upload fixture",
    String.raw`st4ck browse upload --file %TEMP%\fixture.png`,
    /upload --file path outside/,
  );
  expectValidationFailure(
    "Windows drive-relative upload fixture",
    String.raw`st4ck browse upload --file C:tmp\fixture.png`,
    /upload --file path outside/,
  );
}

runValidatorSelfTests();

const allowedMarketplaceKeys = new Set(["name", "owner", "metadata", "plugins"]);
const unknownMarketplaceKeys = Object.keys(marketplace).filter((key) => !allowedMarketplaceKeys.has(key));
check(unknownMarketplaceKeys.length === 0,
  `marketplace root contains keys rejected by Claude 2.1.78: ${unknownMarketplaceKeys.join(", ")}`);

const entry = marketplace.plugins?.find((plugin) => plugin.name === manifest.name);
check(entry, `marketplace has no entry for plugin ${manifest.name}`);
check(entry.source === "./st4ck", "st4ck-lite marketplace source must remain ./st4ck");
check(!Object.hasOwn(entry, "version"),
  "declare the plugin version only in st4ck/.claude-plugin/plugin.json");
check(typeof manifest.version === "string" && parseSemver(manifest.version),
  "plugin.json must contain a valid SemVer version");
check(manifest.author && typeof manifest.author === "object" && typeof manifest.author.name === "string",
  "plugin.json author must be an object accepted by Claude Code");

validateFrontmatter(claudeSkill, "Claude qa-record-test skill");
validateFrontmatter(codexSkill, "Codex st4ck-browse skill");

check(isGreaterVersion("1.2.3-rc.2+build.7", "1.2.3-rc.1"),
  "internal SemVer comparison must support prerelease/build syntax");
check(isGreaterVersion("1.2.3", "1.2.3-rc.2"),
  "a SemVer release must sort after its prereleases");

const versionedPaths = ["st4ck", "codex/skills/st4ck-browse/SKILL.md"];
requireBaseRef(baseRef);
const changedTracked = git(["diff", "--name-only", baseRef, "--", ...versionedPaths])
  .trim().split("\n").filter(Boolean);
const changedUntracked = git(["ls-files", "--others", "--exclude-standard", "--", ...versionedPaths])
  .trim().split("\n").filter(Boolean);
const payloadChanges = [...new Set([...changedTracked, ...changedUntracked])];

if (payloadChanges.length > 0) {
  const baseManifest = JSON.parse(git(["show", `${baseRef}:${manifestPath}`]));
  check(manifest.version !== baseManifest.version,
    `skill/plugin payload changed without a version bump from ${baseManifest.version}: ${payloadChanges.join(", ")}`);
  check(isGreaterVersion(manifest.version, baseManifest.version),
    `plugin version ${manifest.version} must be greater than ${baseManifest.version} from ${baseRef}`);
}

const requiredBrowseContract = [
  ["interactables", /browse interactables\b/],
  ["locate", /browse locate\b/],
  ["get-text", /browse get-text\b/],
  ["assert-contains", /browse assert-contains[^\n]*--contains\b/],
  ["scroll", /browse scroll\b/],
  ["prune", /browse prune\b/],
  ["quiet output", /--format quiet\b/],
  ["focused fill", /browse fill[^\n]*--focused\b/],
  ["settled click", /browse click[^\n]*--settle\b/],
  ["native click", /browse click_native\b/],
  ["native pointer sequence", /browse click_native[^\n]*--pointer-sequence\b/],
  ["locator collision index", /--locator-index\b/],
  ["storage-state auth", /--storage-state\b/],
  ["secure auth temp file", /mktemp[^\n]*st4ck-auth/],
  ["restricted auth permissions", /chmod 600/],
  ["auth cleanup trap", /trap[^\n]*rm -f/],
  ["Bubble guarded click", /browse bubble_click\b[\s\S]{0,180}--refuse-if-conditional-disabled/],
  ["Bubble fill parser", /browse bubble_fill\b[\s\S]{0,180}--selector[\s\S]{0,120}--value\b/],
  ["Bubble select parser", /browse bubble_select\b[\s\S]{0,180}--selector[\s\S]{0,120}--value\b/],
  ["per-operation runtime help", /browse interactables --help\b/],
  ["flat-trace boundary", /(?:flat primitive trace|flat trace)/i],
  ["open-source local components", /basic local reusable component/i],
  ["unshipped local registry", /(?:does not|doesn't|not)\s+(?:yet\s+)?ship[^.\n]*(?:component registry|local component registry)|no local component registry[^.\n]*ships/i],
];

for (const [surfaceName, surface] of [
  ["Claude qa-record-test skill", claudeSkill],
  ["Codex st4ck-browse skill", codexSkill],
]) {
  for (const [featureName, pattern] of requiredBrowseContract) {
    check(pattern.test(surface), `${surfaceName} does not teach ${featureName}`);
  }

  check(/forward compatibility only/i.test(surface) && /do not rely on this launch flag today/i.test(surface),
    `${surfaceName} must state that launch --platform cannot be relied on today`);
  validateBrowseSafety(surfaceName, surface);
}

const shippedDocPaths = [
  "README.md",
  ...markdownFiles("st4ck/commands"),
  ...markdownFiles("st4ck/skills"),
  ...markdownFiles("codex/skills"),
];
const explicitCliPin = /\bst4ck@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/;
for (const relativePath of shippedDocPaths) {
  const doc = read(relativePath);
  check(!explicitCliPin.test(doc),
    `${relativePath} contains a literal st4ck CLI pin; resolve a current version at release/use time`);
  if (/\bst4ck browse\b/i.test(doc)) validateBrowseSafety(relativePath, doc);
}

check(/qa-record-test/.test(browseCommand), "browse command must delegate to qa-record-test");
check(!/--platform/.test(browseCommand), "browse command must not advertise session-level --platform");
check(/st4ck-lite` \/ local/.test(readme) && /Full `st4ck` \+ workspace/.test(readme),
  "README must distinguish the Lite/local and full st4ck+workspace surfaces");
check(readme.includes(`\`${manifest.version}\``),
  `README status must include plugin version ${manifest.version}`);
check(!/10[- ](?:primitive|action)|per-call dispatch flags/i.test(readme),
  "README contains stale compact-vocabulary or Browse dispatch claims");
check(!/plugin manifest schema has no version-pinning field/i.test(readme),
  "README contains the obsolete plugin-version statement");

process.stdout.write(`ok: st4ck-lite ${manifest.version} manifests and Claude/Codex Browse contracts are coherent\n`);
