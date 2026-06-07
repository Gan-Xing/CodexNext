import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const defaultSource = "/Applications/Codex.app/Contents/Resources/app.asar";
const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outputDir = path.join(packageRoot, "svg");
const manifestPath = path.join(packageRoot, "manifest.json");
const generatedModulePath = path.join(packageRoot, "src", "generated.ts");

async function main() {
  const source = readArg("--source") ?? defaultSource;
  const resolved = await resolveAssetsDir(source);

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const fileNames = (await readdir(resolved.assetsDir))
    .filter((name) => name.endsWith(".js"))
    .sort((left, right) => left.localeCompare(right));

  const records = [];
  let extractedCount = 0;

  for (const fileName of fileNames) {
    const filePath = path.join(resolved.assetsDir, fileName);
    const sourceText = await readFile(filePath, "utf8");
    if (!sourceText.includes("svg")) {
      continue;
    }

    const icons = extractSvgEntries(sourceText, fileName);
    if (icons.length === 0) {
      continue;
    }

    const baseName = sanitizeBaseName(fileName);
    const moduleName = sanitizeModuleName(fileName);
    icons.forEach((icon, index) => {
      const outputName =
        icons.length === 1
          ? `${moduleName}.svg`
          : `${moduleName}--${String(index + 1).padStart(2, "0")}.svg`;
      records.push({
        fileName: outputName,
        iconName: baseName,
        sourceModule: fileName,
        sourceVariable: icon.sourceVariable,
        indexInModule: index + 1,
        totalInModule: icons.length,
        width: icon.width,
        height: icon.height,
        viewBox: icon.viewBox
      });
    });
  }

  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.fileName)) {
      throw new Error(`Duplicate output file name generated: ${record.fileName}`);
    }
    seen.add(record.fileName);
  }

  for (const record of records) {
    const sourceText = await readFile(path.join(resolved.assetsDir, record.sourceModule), "utf8");
    const icons = extractSvgEntries(sourceText, record.sourceModule);
    const icon = icons[record.indexInModule - 1];
    if (!icon) {
      throw new Error(`Missing extracted icon for ${record.sourceModule}#${record.indexInModule}`);
    }

    await writeFile(path.join(outputDir, record.fileName), `${icon.svg}\n`, "utf8");
    extractedCount += 1;
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source,
        sourceKind: resolved.sourceKind,
        iconCount: extractedCount,
        icons: records
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await mkdir(path.dirname(generatedModulePath), { recursive: true });
  await writeFile(generatedModulePath, buildGeneratedModule(records), "utf8");

  if (resolved.cleanup) {
    resolved.cleanup();
  }

  console.log(`Extracted ${extractedCount} SVG assets into ${path.relative(process.cwd(), outputDir)}`);
}

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

async function resolveAssetsDir(source) {
  const sourcePath = path.resolve(source);
  const sourceStats = await readStatsOrNull(sourcePath);
  if (sourceStats == null) {
    throw new Error(`Source not found: ${sourcePath}`);
  }

  if (sourceStats.isDirectory()) {
    const directAssets = path.join(sourcePath, "webview", "assets");
    const nestedAssets = path.join(sourcePath, "app", "webview", "assets");
    const assetsDir = (await readStatsOrNull(directAssets))?.isDirectory()
      ? directAssets
      : (await readStatsOrNull(nestedAssets))?.isDirectory()
        ? nestedAssets
        : null;

    if (assetsDir == null) {
      throw new Error(`Could not find webview/assets under directory source: ${sourcePath}`);
    }

    return { assetsDir, sourceKind: "directory", cleanup: null };
  }

  if (!sourcePath.endsWith(".asar")) {
    throw new Error(`Expected a directory source or an .asar file: ${sourcePath}`);
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "codex-icons-"));
  execFileSync("npx", ["--yes", "asar", "extract", sourcePath, tempRoot], {
    stdio: "inherit"
  });

  const assetsDir = path.join(tempRoot, "webview", "assets");
  const assetsStats = await readStatsOrNull(assetsDir);
  if (assetsStats == null || !assetsStats.isDirectory()) {
    rmSync(tempRoot, { force: true, recursive: true });
    throw new Error(`Extracted app bundle did not contain webview/assets: ${sourcePath}`);
  }

  return {
    assetsDir,
    sourceKind: "asar",
    cleanup: () => rmSync(tempRoot, { force: true, recursive: true })
  };
}

async function readStatsOrNull(targetPath) {
  try {
    const fs = await import("node:fs/promises");
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

function extractSvgEntries(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const icons = [];
  const seen = new Set();

  visit(sourceFile);
  return icons;

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const sourceVariable = ts.isIdentifier(node.name) ? node.name.text : "anonymous";
      const svg = extractSvgFromInitializer(node.initializer);
      if (svg != null && !seen.has(svg.svg)) {
        seen.add(svg.svg);
        icons.push({ ...svg, sourceVariable });
      }
    }

    ts.forEachChild(node, visit);
  }
}

function extractSvgFromInitializer(initializer) {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    const body = unwrapExpression(initializer.body);
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        if (ts.isReturnStatement(statement) && statement.expression) {
          const rendered = renderElementNode(statement.expression);
          if (rendered?.tag === "svg") {
            return rendered;
          }
        }
      }
      return null;
    }

    const rendered = renderElementNode(body);
    return rendered?.tag === "svg" ? rendered : null;
  }

  return null;
}

function renderElementNode(node) {
  const expression = unwrapExpression(node);

  if (ts.isCallExpression(expression)) {
    const args = expression.arguments;
    if (args.length < 2) {
      return null;
    }

    const tag = readStaticTagName(args[0]);
    if (tag == null) {
      return null;
    }

    const props = args[1];
    if (!ts.isObjectLiteralExpression(props)) {
      return null;
    }

    return renderElement(tag, props);
  }

  return null;
}

function renderElement(tag, propsNode) {
  const attrs = [];
  let children = "";
  const meta = {};

  for (const property of propsNode.properties) {
    if (ts.isSpreadAssignment(property)) {
      continue;
    }

    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const key = readPropertyName(property.name);
    if (key == null) {
      continue;
    }

    if (key === "children") {
      children += renderChildren(property.initializer);
      continue;
    }

    if (key === "key" || key === "ref") {
      continue;
    }

    const value = readStaticAttributeValue(property.initializer);
    if (value == null) {
      continue;
    }

    if (tag === "svg" && (key === "width" || key === "height" || key === "viewBox")) {
      meta[key] = value;
    }

    attrs.push(`${mapAttributeName(key)}="${escapeXml(value)}"`);
  }

  const openingTag = attrs.length > 0 ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`;
  const svg = children.length > 0 ? `${openingTag}${children}</${tag}>` : `${openingTag}</${tag}>`;

  return {
    tag,
    svg,
    width: meta.width ?? null,
    height: meta.height ?? null,
    viewBox: meta.viewBox ?? null
  };
}

function renderChildren(node) {
  const expression = unwrapExpression(node);

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) => renderChildren(element)).join("");
  }

  const rendered = renderElementNode(expression);
  if (rendered != null) {
    return rendered.svg;
  }

  const text = readStaticAttributeValue(expression);
  return text == null ? "" : escapeXml(text);
}

function unwrapExpression(node) {
  let current = node;

  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function readStaticTagName(node) {
  const value = readStaticAttributeValue(node);
  return value != null && value.length > 0 ? value : null;
}

function readPropertyName(nameNode) {
  if (ts.isIdentifier(nameNode)) {
    return nameNode.text;
  }
  if (ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  if (ts.isComputedPropertyName(nameNode)) {
    return readStaticAttributeValue(nameNode.expression);
  }
  return null;
}

function readStaticAttributeValue(node) {
  const expression = unwrapExpression(node);

  if (ts.isNoSubstitutionTemplateLiteral(expression) || ts.isStringLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) {
    return expression.text;
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return "true";
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return "false";
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    return `${expression.operator === ts.SyntaxKind.MinusToken ? "-" : ""}${expression.operand.text}`;
  }
  if (ts.isTemplateExpression(expression) && expression.templateSpans.length === 0) {
    return expression.head.text;
  }
  return null;
}

function mapAttributeName(name) {
  if (name === "viewBox") {
    return "viewBox";
  }

  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function sanitizeBaseName(fileName) {
  const stem = fileName.replace(/\.js$/u, "").replace(/-[A-Za-z0-9_-]+$/u, "");
  return sanitizeName(stem);
}

function sanitizeModuleName(fileName) {
  const stem = fileName.replace(/\.js$/u, "");
  return sanitizeName(stem);
}

function sanitizeName(value) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildGeneratedModule(records) {
  const lines = [
    "// This file is generated by packages/codex-icons/scripts/extract-codex-icons.mjs",
    "// Do not edit by hand.",
    "",
    "export const codexAssetSvgByName = {"
  ];

  for (const record of records) {
    const svgPath = path.join(outputDir, record.fileName);
    const svg = readFileSyncUtf8(svgPath);
    lines.push(`  ${JSON.stringify(record.fileName.replace(/\.svg$/u, ""))}: ${JSON.stringify(svg.trim())},`);
  }

  lines.push("} as const;", "");
  lines.push("export type CodexAssetName = keyof typeof codexAssetSvgByName;", "");

  return `${lines.join("\n")}\n`;
}

function readFileSyncUtf8(targetPath) {
  return readFileSync(targetPath, "utf8");
}

await main();
