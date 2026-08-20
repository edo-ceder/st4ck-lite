#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseRef = process.env.ST4CK_LITE_BASE_REF ?? "origin/main";
const manifestPath = "st4ck/.claude-plugin/plugin.json";
const codexManifestPath = "plugins/st4ck-lite/.codex-plugin/plugin.json";
const codexSkillPath = "plugins/st4ck-lite/skills/st4ck-browse/SKILL.md";
const codexAgentPath = "plugins/st4ck-lite/skills/st4ck-browse/agents/openai.yaml";
const legacyCodexSkillPath = "codex/skills/st4ck-browse/SKILL.md";

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const parse = (relativePath) => JSON.parse(read(relativePath));

const marketplace = parse(".claude-plugin/marketplace.json");
const manifest = parse(manifestPath);
const codexMarketplace = parse(".agents/plugins/marketplace.json");
const codexManifest = parse(codexManifestPath);
const browseCommand = read("st4ck/commands/browse.md");
const claudeSkill = read("st4ck/skills/qa-record-test/SKILL.md");
const codexSkill = read(codexSkillPath);
const codexAgent = read(codexAgentPath);
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
  let parsedDescription;
  try {
    parsedDescription = JSON.parse(description);
    check(typeof parsedDescription === "string" && parsedDescription.trim().length > 0,
      `${label} description must be a non-empty string`);
  } catch (error) {
    throw new Error(`${label} description is not a valid quoted YAML scalar: ${error.message}`);
  }

  return { name, description: parsedDescription };
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
  let mayExecute = false;

  const flushExpandableSegment = (mode = "unquoted") => {
    const controlSegment = expandableSegment.replace(/<[a-z][a-z0-9_-]*>/gi, "");
    const commandSubstitution = /\$\(|`/.test(expandableSegment);
    const shellControl = mode === "unquoted" && /[<>();&|]/.test(controlSegment);
    if (/\$/.test(expandableSegment)
      || /`/.test(expandableSegment)
      || /%[^%]+%/.test(expandableSegment)
      || /![^!]+!/.test(expandableSegment)
      || (mode === "unquoted" && /[{}<>();&|*?\[]/.test(controlSegment))) {
      mayExpand = true;
    }
    if (commandSubstitution || shellControl) mayExecute = true;
    expandableSegment = "";
  };

  const pushToken = () => {
    if (!tokenStarted) return;
    flushExpandableSegment();
    tokens.push({ value, mayExpand, mayExecute });
    value = "";
    tokenStarted = false;
    mayExpand = false;
    mayExecute = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (quote === '"' && character === "\\" && index + 1 < command.length
        && /[$`"\\\n]/.test(command[index + 1])) {
        // Preserve the path spelling for cross-platform checks, but do not
        // treat a shell-escaped metacharacter as executable expansion syntax.
        flushExpandableSegment("double");
        value += character + command[index + 1];
        index += 1;
      } else if (character === quote) {
        const closedQuote = quote;
        quote = null;
        if (closedQuote === '"') flushExpandableSegment("double");
      } else {
        // Preserve backslashes so path.win32 can recognize quoted Windows
        // drive and UNC paths while tracking double-quoted expansion syntax.
        value += character;
        if (quote === '"') expandableSegment += character;
      }
      tokenStarted = true;
      continue;
    }

    if (character === "#" && !tokenStarted) {
      // An unquoted # at a shell token boundary starts an inline comment.
      break;
    } else if (character === "'" || character === '"') {
      if (expandableSegment.endsWith("$")) mayExpand = true;
      flushExpandableSegment("unquoted");
      quote = character;
      tokenStarted = true;
    } else if (character === "\\" && index + 1 < command.length) {
      // Keep backslashes so Windows absolute/traversal checks still see them,
      // while separating an escaped metacharacter from expandable syntax.
      flushExpandableSegment("unquoted");
      value += character + command[index + 1];
      index += 1;
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
      check(!valueToken.value.startsWith("-")
        || /[./\\]/.test(valueToken.value.replace(/^-+/, "")),
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
    check(tokens.every((token) => !token.mayExecute),
      `${surfaceName} contains executable shell expansion or control syntax: ${command}`);
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
  validateBrowseSafety(
    "escaped literal filename fixture",
    String.raw`st4ck browse upload --file fixtures/\$HOME.png`,
  );
  validateBrowseSafety(
    "double-quoted escaped literal filename fixture",
    String.raw`st4ck browse upload --file "fixtures/\$HOME.png"`,
  );
  validateBrowseSafety(
    "explicit equals dash filename fixture",
    "st4ck browse screenshot --out=-h",
  );
  validateBrowseSafety(
    "single-quoted control literal fixture",
    "st4ck browse upload --file 'fixtures/price;1.png'",
  );
  validateBrowseSafety(
    "single-quoted glob literal fixture",
    "st4ck browse upload --file 'fixtures/*.png'",
  );
  validateBrowseSafety(
    "escaped glob literal fixture",
    String.raw`st4ck browse upload --file fixtures/\*.png`,
  );
  validateBrowseSafety(
    "documentation placeholder fixture",
    "st4ck browse launch <url> --session <slug>",
  );

  expectValidationFailure(
    "missing screenshot path fixture",
    "st4ck browse screenshot --out --full-page",
    /without a path value/,
  );
  expectValidationFailure(
    "short option missing screenshot path fixture",
    "st4ck browse screenshot --out -h",
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
  expectValidationFailure(
    "brace expansion screenshot fixture",
    "st4ck browse screenshot --out {..,fixtures}/outside.png",
    /screenshot --out path outside/,
  );
  expectValidationFailure(
    "mixed-quote brace expansion screenshot fixture",
    'st4ck browse screenshot --out {..,"fixtures"}/outside.png',
    /screenshot --out path outside/,
  );
  expectValidationFailure(
    "ANSI-C quoted screenshot fixture",
    "st4ck browse screenshot --out $'../outside.png'",
    /screenshot --out path outside/,
  );
  expectValidationFailure(
    "process substitution screenshot fixture",
    "st4ck browse screenshot --out <(printf-fixture)",
    /executable shell expansion or control syntax/,
  );
  expectValidationFailure(
    "CMD delayed expansion upload fixture",
    String.raw`st4ck browse upload --file !TEMP!\fixture.png`,
    /upload --file path outside/,
  );
  expectValidationFailure(
    "glob upload fixture",
    "st4ck browse upload --file fixtures/*.png",
    /upload --file path outside/,
  );
  expectValidationFailure(
    "question-mark glob screenshot fixture",
    "st4ck browse screenshot --out artifacts/page?.png",
    /screenshot --out path outside/,
  );
  expectValidationFailure(
    "bracket glob upload fixture",
    "st4ck browse upload --file fixtures/[ab].png",
    /upload --file path outside/,
  );
  expectValidationFailure(
    "shell redirection fixture",
    "st4ck browse screenshot --out artifacts/x.png > ../outside.txt",
    /executable shell expansion or control syntax/,
  );
  expectValidationFailure(
    "non-path command substitution fixture",
    "st4ck browse screenshot --out artifacts/x.png $(touch ../outside)",
    /executable shell expansion or control syntax/,
  );
  expectValidationFailure(
    "empty operation redirection fixture",
    'st4ck browse "" > ../outside.txt',
    /executable shell expansion or control syntax/,
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

const allowedCodexMarketplaceKeys = new Set(["name", "interface", "plugins"]);
const unknownCodexMarketplaceKeys = Object.keys(codexMarketplace)
  .filter((key) => !allowedCodexMarketplaceKeys.has(key));
check(unknownCodexMarketplaceKeys.length === 0,
  `Codex marketplace root contains unsupported keys: ${unknownCodexMarketplaceKeys.join(", ")}`);
check(codexMarketplace.name === "st4ck-lite-marketplace",
  "Codex marketplace name must remain st4ck-lite-marketplace");
check(codexMarketplace.interface?.displayName === "st4ck Lite",
  "Codex marketplace must expose the st4ck Lite display name");

const codexEntry = codexMarketplace.plugins?.find((plugin) => plugin.name === codexManifest.name);
check(codexEntry, `Codex marketplace has no entry for plugin ${codexManifest.name}`);
check(codexEntry.source?.source === "local"
  && codexEntry.source?.path === "./plugins/st4ck-lite",
  "Codex marketplace source must remain the local ./plugins/st4ck-lite package");
check(codexEntry.policy?.installation === "AVAILABLE"
  && codexEntry.policy?.authentication === "ON_INSTALL",
  "Codex marketplace policy must remain AVAILABLE with ON_INSTALL authentication timing");
check(codexEntry.category === "Engineering",
  "Codex marketplace category must remain Engineering");
check(!Object.hasOwn(codexEntry, "version"),
  "declare the Codex plugin version only in plugins/st4ck-lite/.codex-plugin/plugin.json");

const allowedCodexManifestKeys = new Set([
  "name", "version", "description", "author", "homepage", "repository",
  "license", "keywords", "skills", "interface",
]);
const unknownCodexManifestKeys = Object.keys(codexManifest)
  .filter((key) => !allowedCodexManifestKeys.has(key));
check(unknownCodexManifestKeys.length === 0,
  `Codex plugin manifest contains unsupported keys: ${unknownCodexManifestKeys.join(", ")}`);
check(codexManifest.name === manifest.name,
  "Claude and Codex plugin manifests must use the same plugin name");
check(typeof codexManifest.version === "string" && parseSemver(codexManifest.version),
  "Codex plugin manifest must contain a valid SemVer version");
check(codexManifest.version === manifest.version,
  "Claude and Codex plugin manifest versions must match");
check(codexManifest.description === "Provide st4ck Browse guidance for explicitly requested browser QA and deterministic local test recording.",
  "Codex plugin description must preserve the explicit browser-QA boundary");
check(codexManifest.skills === "./skills/",
  "Codex plugin manifest skills path must remain ./skills/");
check(codexManifest.author && typeof codexManifest.author === "object"
  && typeof codexManifest.author.name === "string",
  "Codex plugin manifest author must be an object with a name");
for (const field of [
  "displayName", "shortDescription", "longDescription", "developerName", "category",
]) {
  check(typeof codexManifest.interface?.[field] === "string"
    && codexManifest.interface[field].trim().length > 0,
    `Codex plugin interface.${field} must be a non-empty string`);
}
check(Array.isArray(codexManifest.interface?.capabilities)
  && codexManifest.interface.capabilities.every((value) => typeof value === "string" && value.trim()),
  "Codex plugin interface.capabilities must be an array of non-empty strings");
check(Array.isArray(codexManifest.interface?.defaultPrompt)
  && codexManifest.interface.defaultPrompt.length >= 1
  && codexManifest.interface.defaultPrompt.length <= 3
  && codexManifest.interface.defaultPrompt.every(
    (value) => typeof value === "string" && value.length > 0 && value.length <= 128,
  ),
  "Codex plugin interface.defaultPrompt must contain 1-3 non-empty strings of at most 128 characters");
check(codexManifest.interface.defaultPrompt[0]
  === "Use $st4ck-browse to verify this UI and record a replayable test.",
  "Codex plugin interface.defaultPrompt must explicitly invoke $st4ck-browse");
check(!fs.existsSync(path.join(root, legacyCodexSkillPath)),
  `legacy Codex skill source must be removed: ${legacyCodexSkillPath}`);

validateFrontmatter(claudeSkill, "Claude qa-record-test skill");
const codexFrontmatter = validateFrontmatter(codexSkill, "Codex st4ck-browse skill");
const expectedCodexDescription = "Drive a browser with the st4ck Browse CLI only when the user explicitly says \"st4ck browse\" or \"st4ck browser\", explicitly invokes $st4ck-browse, or explicitly asks to use st4ck for browser QA or test recording. Do not use for general st4ck refresh, sync, deploy, logs, issues, API, or MCP work unless browser interaction is explicitly requested.";
check(codexFrontmatter.description === expectedCodexDescription,
  "Codex st4ck-browse description must preserve the explicit browser-intent boundary");
check(/Do not use this skill for general st4ck refresh, sync, deploy, logs, issues, API, or MCP work unless browser interaction is explicitly requested\./.test(codexSkill),
  "Codex st4ck-browse body must preserve the non-browser st4ck exclusions");
check(/default_prompt: "Use \$st4ck-browse\b/.test(codexAgent),
  "Codex st4ck-browse agent metadata must provide an explicit $st4ck-browse prompt");
check(/policy:\n\s+allow_implicit_invocation: false\b/.test(codexAgent),
  "Codex st4ck-browse must require explicit invocation");

check(isGreaterVersion("1.2.3-rc.2+build.7", "1.2.3-rc.1"),
  "internal SemVer comparison must support prerelease/build syntax");
check(isGreaterVersion("1.2.3", "1.2.3-rc.2"),
  "a SemVer release must sort after its prereleases");

const versionedPaths = [
  "st4ck",
  ".agents/plugins/marketplace.json",
  "plugins/st4ck-lite",
  "codex",
];
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
  ...markdownFiles("plugins/st4ck-lite/skills"),
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
check(readme.includes("codex plugin marketplace add https://github.com/edo-ceder/st4ck-lite.git")
  && readme.includes("codex plugin marketplace upgrade st4ck-lite-marketplace")
  && readme.includes("codex plugin add st4ck-lite@st4ck-lite-marketplace"),
  "README must document native Codex install and update commands");
check(readme.includes("Invoke the browser workflow explicitly with `$st4ck-browse`."),
  "README must document explicit Codex skill invocation");
check(!/10[- ](?:primitive|action)|per-call dispatch flags/i.test(readme),
  "README contains stale compact-vocabulary or Browse dispatch claims");
check(!/plugin manifest schema has no version-pinning field/i.test(readme),
  "README contains the obsolete plugin-version statement");

process.stdout.write(`ok: st4ck-lite ${manifest.version} native Claude/Codex packages and Browse contracts are coherent\n`);
