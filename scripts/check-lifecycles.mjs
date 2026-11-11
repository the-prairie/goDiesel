#!/usr/bin/env node
// Keep the lifecycle registry and the code in step.
//
//   node scripts/check-lifecycles.mjs [--root DIR]          check, exit 1 on any mismatch
//   node scripts/check-lifecycles.mjs [--root DIR] --write  regenerate the inventory block
//
// The registry is docs/architecture/lifecycles.json, validated against
// docs/architecture/lifecycles.schema.json. The check fails when:
// - the registry does not match the schema, or two entries share an id;
// - a registered module, test, or adapter path does not exist;
// - a registered transition is not exported from its module (TypeScript
//   `export function|const <name>`, Python top-level `def <name>`);
// - no registered test mentions a registered transition;
// - a registered state name does not appear in its module;
// - a `*-state.ts` file under app/src or admin-ui has no entry;
// - an exported `reduce<Name>` function under app/src or admin-ui, or a
//   top-level Python `def reduce_<name>` at the repository root, is not a
//   registered transition of that module;
// - the generated block in docs/architecture/state-machines.md is missing or
//   differs from what --write would produce.
// No dependencies: the schema subset it needs is validated here.

import fs from "node:fs";
import path from "node:path";

const REGISTRY = "docs/architecture/lifecycles.json";
const SCHEMA = "docs/architecture/lifecycles.schema.json";
const DOC = "docs/architecture/state-machines.md";
const BEGIN = "<!-- BEGIN GENERATED: lifecycles.json -->";
const END = "<!-- END GENERATED: lifecycles.json -->";
const STATE_ROOTS = ["app/src", "admin-ui"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "generated", "dist", ".git"]);
const KIND_ORDER = ["reducer", "disposition", "protocol", "derived", "left-implicit"];

function parseArguments(argv) {
  const options = { root: path.resolve(import.meta.dirname, ".."), write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--root" && argv[index + 1]) options.root = path.resolve(argv[++index]);
    else {
      console.error(`Unknown argument ${JSON.stringify(argument)}.`);
      console.error("Usage: node scripts/check-lifecycles.mjs [--root DIR] [--write]");
      process.exit(2);
    }
  }
  return options;
}

// --- A JSON Schema subset: type, enum, const, required, properties,
// additionalProperties false, items, minItems, uniqueItems, minLength,
// pattern, anyOf, allOf, if/then, and local $ref.

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function validate(schema, value, where, root, errors) {
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, "").split("/").reduce((node, key) => node?.[key], root);
    if (!target) throw new Error(`Unresolvable $ref ${schema.$ref}`);
    validate(target, value, where, root, errors);
  }
  if (schema.type) {
    const actual = typeOf(value);
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = allowed.some((type) => type === actual || (type === "number" && actual === "integer"));
    if (!matches) {
      errors.push(`${where}: must be ${allowed.join(" or ")}, found ${actual}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(`${where}: must be one of ${schema.enum.join(", ")}`);
  }
  if ("const" in schema && schema.const !== value) errors.push(`${where}: must be ${JSON.stringify(schema.const)}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${where}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${where}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${where}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${where}: items must be unique`);
    }
    if (schema.items) value.forEach((item, index) => validate(schema.items, item, `${where}[${index}]`, root, errors));
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${where}: missing required "${key}"`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(schema.properties[key], item, `${where}.${key}`, root, errors);
      else if (schema.additionalProperties === false) errors.push(`${where}: unknown property "${key}"`);
    }
  }
  if (schema.anyOf) {
    const passes = schema.anyOf.some((option) => {
      const optionErrors = [];
      validate(option, value, where, root, optionErrors);
      return optionErrors.length === 0;
    });
    if (!passes) errors.push(`${where}: matches none of the allowed shapes`);
  }
  for (const part of schema.allOf ?? []) {
    if (part.if) {
      const conditionErrors = [];
      validate(part.if, value, where, root, conditionErrors);
      if (conditionErrors.length === 0 && part.then) validate(part.then, value, where, root, errors);
    } else {
      validate(part, value, where, root, errors);
    }
  }
}

// --- Code facts.

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exists(root, relative) {
  return fs.existsSync(path.join(root, relative));
}

function isExported(source, modulePath, name) {
  const word = escapeRegExp(name);
  if (modulePath.endsWith(".py")) {
    return new RegExp(`^(async\\s+)?def\\s+${word}\\s*\\(`, "m").test(source);
  }
  return new RegExp(`^export\\s+(async\\s+)?(function\\*?|const|let)\\s+${word}\\b`, "m").test(source);
}

function mentions(source, name) {
  return new RegExp(`(^|[^\\w-])${escapeRegExp(name)}($|[^\\w-])`).test(source);
}

function walk(root, relative, files) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return files;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(root, child, files);
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

function isTestFile(file) {
  return /\.(test|spec)\.tsx?$/.test(file);
}

// --- Checks.

function checkRegistry(root, registry, schema) {
  const errors = [];
  validate(schema, registry, "lifecycles.json", schema, errors);
  if (errors.length > 0) return errors;

  const entries = registry.lifecycles;
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) errors.push(`duplicate id "${entry.id}"`);
    seen.add(entry.id);
  }

  for (const entry of entries) {
    const label = `${entry.id}`;
    const paths = [["module", entry.module], ...(entry.test ?? []).map((t) => ["test", t]),
      ...entry.adapters.map((a) => ["adapter", a])];
    let missing = false;
    for (const [role, relative] of paths) {
      if (!exists(root, relative)) {
        errors.push(`${label}: ${role} ${relative} does not exist`);
        if (role === "module") missing = true;
      }
    }
    if (missing) continue;
    const source = read(root, entry.module);

    if (entry.transition) {
      if (!isExported(source, entry.module, entry.transition)) {
        const form = entry.module.endsWith(".py") ? "a top-level def" : "an exported function or const";
        errors.push(`${label}: ${entry.transition} is not ${form} in ${entry.module}`);
      }
      const tests = (entry.test ?? []).filter((t) => exists(root, t));
      if (tests.length > 0 && !tests.some((t) => mentions(read(root, t), entry.transition))) {
        errors.push(`${label}: no registered test mentions ${entry.transition} (${tests.join(", ")})`);
      }
    }

    for (const state of entry.states ?? []) {
      const name = state.includes(":") ? state.slice(state.indexOf(":") + 1) : state;
      if (!mentions(source, name)) errors.push(`${label}: state "${name}" does not appear in ${entry.module}`);
    }
  }

  const registered = new Set(entries.map((entry) => entry.module));
  const transitions = new Set(entries.filter((e) => e.transition).map((e) => `${e.module}#${e.transition}`));
  for (const stateRoot of STATE_ROOTS) {
    for (const file of walk(root, stateRoot, [])) {
      if (isTestFile(file) || !/\.tsx?$/.test(file)) continue;
      if (file.endsWith("-state.ts") && !registered.has(file)) {
        errors.push(`${file} is a lifecycle module with no entry in ${REGISTRY}`);
      }
      const source = read(root, file);
      for (const match of source.matchAll(/^export\s+function\s+(reduce[A-Z]\w*)/gm)) {
        if (!transitions.has(`${file}#${match[1]}`)) {
          errors.push(`${file} exports reducer ${match[1]} with no entry in ${REGISTRY}`);
        }
      }
    }
  }
  for (const file of fs.readdirSync(root)) {
    if (!file.endsWith(".py") || file.startsWith("test_")) continue;
    const source = read(root, file);
    for (const match of source.matchAll(/^def\s+(reduce_\w+)\s*\(/gm)) {
      if (!transitions.has(`${file}#${match[1]}`)) {
        errors.push(`${file} defines reducer ${match[1]} with no entry in ${REGISTRY}`);
      }
    }
  }
  return errors;
}

// --- The generated inventory.

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function code(text) {
  return `\`${text}\``;
}

function nameCell(entry) {
  return entry.inProgress ? `${code(entry.id)} (in progress on ${code(entry.inProgress)})` : code(entry.id);
}

function statesCell(entry) {
  return entry.states?.length ? entry.states.map(code).join(", ") : "none";
}

function identityCell(entry) {
  return entry.identity === null ? "nothing" : cell(entry.identity);
}

const SECTIONS = {
  reducer: {
    title: "Reducers",
    header: ["Lifecycle", "Owns", "Module", "Transition", "States", "Stale events rejected by"],
    row: (e) => [nameCell(e), cell(e.summary), code(e.module), code(e.transition), statesCell(e), identityCell(e)],
  },
  disposition: {
    title: "Dispositions",
    header: ["Lifecycle", "Owns", "Module", "Transition", "Outcomes", "Guarded by"],
    row: (e) => [nameCell(e), cell(e.summary), code(e.module), code(e.transition), statesCell(e), identityCell(e)],
  },
  protocol: {
    title: "Marker-file protocols",
    header: ["Lifecycle", "Owns", "Module", "States", "Identity"],
    row: (e) => [nameCell(e), cell(e.summary), code(e.module), statesCell(e), identityCell(e)],
  },
  derived: {
    title: "Derived, not stored",
    header: ["Lifecycle", "Owns", "Module", "Values", "Why"],
    row: (e) => [nameCell(e), cell(e.summary), code(e.module), statesCell(e), cell(e.reason)],
  },
  "left-implicit": {
    title: "Left implicit on purpose",
    header: ["Lifecycle", "Owns", "Module", "Why"],
    row: (e) => [nameCell(e), cell(e.summary), code(e.module), cell(e.reason)],
  },
};

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function generatedBlock(registry) {
  const entries = registry.lifecycles;
  const counts = KIND_ORDER.map((kind) => [kind, entries.filter((e) => e.kind === kind).length]);
  const parts = [
    BEGIN,
    "<!-- Generated from docs/architecture/lifecycles.json by `node scripts/check-lifecycles.mjs --write`. Do not edit by hand. -->",
    "",
    table(["Kind", "Entries"], [...counts.map(([kind, count]) => [code(kind), String(count)]), ["total", String(entries.length)]]),
  ];
  for (const kind of KIND_ORDER) {
    const members = entries.filter((e) => e.kind === kind);
    if (members.length === 0) continue;
    const section = SECTIONS[kind];
    parts.push("", `### ${section.title}`, "", table(section.header, members.map(section.row)));
  }
  parts.push("", END);
  return parts.join("\n");
}

function blockBounds(text) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1 || end < start) return null;
  return { start, end: end + END.length };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const { root } = options;
  const errors = [];
  let registry;
  let schema;
  try {
    registry = JSON.parse(read(root, REGISTRY));
    schema = JSON.parse(read(root, SCHEMA));
  } catch (error) {
    console.error(`Lifecycle check failed: cannot read ${REGISTRY} or ${SCHEMA}: ${error.message}`);
    process.exit(1);
  }
  errors.push(...checkRegistry(root, registry, schema));

  const schemaValid = !errors.some((error) => error.startsWith("lifecycles.json"));
  if (schemaValid) {
    const docPath = path.join(root, DOC);
    const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
    const bounds = blockBounds(doc);
    if (!bounds) {
      errors.push(`${DOC} has no "${BEGIN}" ... "${END}" block`);
    } else {
      const expected = generatedBlock(registry);
      const current = doc.slice(bounds.start, bounds.end);
      if (current !== expected) {
        if (options.write) {
          fs.writeFileSync(docPath, doc.slice(0, bounds.start) + expected + doc.slice(bounds.end));
          console.log(`Regenerated the inventory block in ${DOC}.`);
        } else {
          errors.push(`${DOC} inventory block is stale. Run node scripts/check-lifecycles.mjs --write`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Lifecycle check failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Lifecycle registry ok: ${registry.lifecycles.length} entries match the code.`);
}

main();
