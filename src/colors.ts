export interface ParsedColor {
  rgb: readonly [number, number, number];
  alpha?: number;
}

const HEX_RE = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTION_RE = /^(rgba?)\((.*)\)$/is;
const CHANNEL_RE = /^[+-]?\d+%?$/;
const PERCENTAGE_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/;
const ALPHA_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/;

function roundChannel(value: number): number {
  return Math.round(value);
}

function parseChannel(value: string): number | undefined {
  if (!CHANNEL_RE.test(value) && !PERCENTAGE_RE.test(value)) return undefined;

  if (value.endsWith("%")) {
    if (!PERCENTAGE_RE.test(value)) return undefined;
    const percentage = Number.parseFloat(value.slice(0, -1));
    if (percentage < 0 || percentage > 100) return undefined;
    return roundChannel((percentage / 100) * 255);
  }

  const channel = Number(value);
  if (!Number.isInteger(channel) || channel < 0 || channel > 255) return undefined;
  return channel;
}

function parseAlpha(value: string): number | undefined {
  if (!ALPHA_RE.test(value)) return undefined;

  if (value.endsWith("%")) {
    const percentage = Number.parseFloat(value.slice(0, -1));
    if (percentage < 0 || percentage > 100) return undefined;
    return percentage / 100;
  }

  const alpha = Number(value);
  if (alpha < 0 || alpha > 1) return undefined;
  return alpha;
}

function parseHex(value: string): ParsedColor | undefined {
  if (!HEX_RE.test(value)) return undefined;

  const digits = value.slice(1);
  const channels = digits.length <= 4
    ? [...digits].map((digit) => Number.parseInt(digit + digit, 16))
    : [
        Number.parseInt(digits.slice(0, 2), 16),
        Number.parseInt(digits.slice(2, 4), 16),
        Number.parseInt(digits.slice(4, 6), 16),
      ];

  const alpha = digits.length === 4
    ? Number.parseInt(digits[3] + digits[3], 16) / 255
    : digits.length === 8
      ? Number.parseInt(digits.slice(6, 8), 16) / 255
      : undefined;

  return {
    rgb: [channels[0], channels[1], channels[2]],
    ...(alpha === undefined ? {} : { alpha }),
  };
}

function parseFunction(value: string): ParsedColor | undefined {
  const match = FUNCTION_RE.exec(value);
  if (!match) return undefined;

  const name = match[1].toLowerCase();
  const body = match[2].trim();
  let channels: string[];
  let alphaToken: string | undefined;

  if (body.includes(",")) {
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length < 3 || parts.length > 4 || parts.some((part) => part.length === 0)) {
      return undefined;
    }
    channels = parts.slice(0, 3);
    alphaToken = parts[3];
    if (name === "rgba" && alphaToken === undefined) return undefined;
  } else {
    const slashParts = body.split("/");
    if (slashParts.length > 2) return undefined;
    const channelParts = slashParts[0].trim().split(/\s+/);
    if (channelParts.length !== 3 || channelParts.some((part) => part.length === 0)) {
      return undefined;
    }
    channels = channelParts;
    alphaToken = slashParts[1]?.trim();
    if (alphaToken === "") return undefined;
    if (name === "rgba" && alphaToken === undefined) return undefined;
  }

  const parsedChannels = channels.map(parseChannel);
  if (parsedChannels.some((channel) => channel === undefined)) return undefined;

  const alpha = alphaToken === undefined ? undefined : parseAlpha(alphaToken);
  if (alphaToken !== undefined && alpha === undefined) return undefined;

  return {
    rgb: [parsedChannels[0]!, parsedChannels[1]!, parsedChannels[2]!],
    ...(alpha === undefined ? {} : { alpha }),
  };
}

/** Parse one complete CSS color literal without changing its spelling. */
export function parseColorLiteral(value: string): ParsedColor | undefined {
  return value.startsWith("#") ? parseHex(value) : parseFunction(value);
}

/** Round alpha to the nearest integer percentage; exact halves round upward. */
export function alphaPercent(alpha: number): number {
  // The small tolerance avoids binary floating-point values such as .145 * 100
  // becoming 14.499999999999998. Alpha is constrained to [0, 1] by parsing.
  const rounded = Math.floor(alpha * 100 + 0.5 + Number.EPSILON * 100);
  return Math.min(100, Math.max(0, rounded));
}

const ANSI_PALETTE: (readonly [number, number, number])[] = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

const ANSI_CUBE = [0, 95, 135, 175, 215, 255];
for (const red of ANSI_CUBE) {
  for (const green of ANSI_CUBE) {
    for (const blue of ANSI_CUBE) ANSI_PALETTE.push([red, green, blue]);
  }
}
for (let value = 8; value <= 238; value += 10) ANSI_PALETTE.push([value, value, value]);

function nearestAnsi256(rgb: readonly [number, number, number]): number {
  let bestIndex = 16;
  let bestDistance = Number.POSITIVE_INFINITY;
  // Entries 0-15 are the terminal's configurable basic colors. Use only the
  // fixed cube and grayscale entries so fallback output is deterministic.
  for (let index = 16; index < ANSI_PALETTE.length; index += 1) {
    const color = ANSI_PALETTE[index];
    const distance = (rgb[0] - color[0]) ** 2 + (rgb[1] - color[1]) ** 2 + (rgb[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

const SQUARE = "■";
// An empty link is invisible in pi-tui's renderer. It causes the renderer to
// append its current style prefix after the swatch's foreground reset, which
// restores heading/default foregrounds without guessing the user's theme.
const STYLE_RESTORE_MARKER = "[]()";
const ANSI_DECORATION_RE = /^ (?:\u001b\[38;2;\d+;\d+;\d+m|\u001b\[38;5;\d+m)■\u001b\[39m(?:\[\]\(\))?(?: \d+%)?/;

function decoration(color: ParsedColor, trueColor: boolean, restoreStyle: boolean): string {
  const [red, green, blue] = color.rgb;
  const colorCode = trueColor
    ? `\u001b[38;2;${red};${green};${blue}m`
    : `\u001b[38;5;${nearestAnsi256(color.rgb)}m`;
  const label = color.alpha === undefined ? "" : ` ${alphaPercent(color.alpha)}%`;
  const restore = restoreStyle ? STYLE_RESTORE_MARKER : "";
  return ` ${colorCode}${SQUARE}\u001b[39m${restore}${label}`;
}

interface ProtectedRange {
  start: number;
  end: number;
}

interface InlineCodeSpan {
  start: number;
  end: number;
  literalStart: number;
  literalEnd: number;
}

function isInRange(position: number, ranges: readonly ProtectedRange[]): boolean {
  return ranges.some((range) => position >= range.start && position < range.end);
}

function addRange(ranges: ProtectedRange[], start: number, end: number): void {
  if (end > start) ranges.push({ start, end });
}

function isEscaped(source: string, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function containerContent(line: string): string {
  let position = 0;
  while (position < line.length) {
    let spaces = 0;
    while (spaces < 3 && line[position + spaces] === " ") spaces += 1;
    const containerStart = position + spaces;

    if (line[containerStart] === ">") {
      position = containerStart + 1;
      if (line[position] === " " || line[position] === "\t") position += 1;
      continue;
    }

    const list = /^(?:[*+-]|\d{1,9}[.)])[ \t]/.exec(line.slice(containerStart));
    if (list) {
      // Consume the marker and one separator. Further indentation belongs to
      // the item content and can make that content an indented code block.
      position = containerStart + list[0].length;
      continue;
    }
    break;
  }
  return line.slice(position);
}

function addLineRange(ranges: ProtectedRange[], start: number, end: number): void {
  addRange(ranges, start, end);
}

function protectHTML(markdown: string, ranges: ProtectedRange[]): void {
  // Protect tags and HTML comments, including attributes containing colors.
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "<") continue;
    if (markdown.startsWith("<!--", index)) {
      const close = markdown.indexOf("-->", index + 4);
      addRange(ranges, index, close < 0 ? markdown.length : close + 3);
      if (close >= 0) index = close + 2;
      else break;
      continue;
    }
    if (markdown.startsWith("<![CDATA[", index)) {
      const close = markdown.indexOf("]]>", index + 9);
      addRange(ranges, index, close < 0 ? markdown.length : close + 3);
      if (close >= 0) index = close + 2;
      else break;
      continue;
    }
    const next = markdown[index + 1];
    const isTag = next === "!" || next === "?" || next === "/"
      ? /[A-Za-z]/.test(markdown[index + 2] ?? "")
      : /[A-Za-z]/.test(next ?? "");
    if (!isTag) continue;

    let quote: string | undefined;
    let close = index + 1;
    for (; close < markdown.length; close += 1) {
      const character = markdown[close];
      if (quote) {
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    addRange(ranges, index, close < markdown.length ? close + 1 : markdown.length);
    if (close >= markdown.length) break;
    index = close;
  }

  // Block HTML is raw Markdown. Protect the complete block because pi-tui
  // renders HTML tokens as text, so a restore link would otherwise be visible.
  const blockTags = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|ol|p|pre|script|section|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul|xmp)$/i;
  let rawTag: { name: string; depth: number } | undefined;
  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd);
    const content = containerContent(line);
    const opening = /^ {0,3}<([A-Za-z][A-Za-z0-9-]*)(?=[ \t/>])/.exec(content);
    const closing = /^ {0,3}<\/([A-Za-z][A-Za-z0-9-]*)\s*>/.exec(content);

    if (rawTag) {
      addLineRange(ranges, lineStart, lineEnd);
      const openRe = new RegExp(`<${rawTag.name}(?=[\\s/>])`, "gi");
      const closeRe = new RegExp(`</${rawTag.name}\\s*>`, "gi");
      const opens = content.match(openRe)?.length ?? 0;
      const closes = content.match(closeRe)?.length ?? 0;
      rawTag.depth += opens - closes;
      if (rawTag.depth <= 0) rawTag = undefined;
    } else if (opening && blockTags.test(opening[1])) {
      addLineRange(ranges, lineStart, lineEnd);
      const tag = opening[1];
      const openRe = new RegExp(`<${tag}(?=[\\s/>])`, "gi");
      const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
      const opens = content.match(openRe)?.length ?? 0;
      const closes = content.match(closeRe)?.length ?? 0;
      const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/\\s*>`, "i").test(content);
      const depth = opens - closes - (selfClosing ? 1 : 0);
      if (depth > 0) rawTag = { name: tag, depth };
    } else if (closing && blockTags.test(closing[1])) {
      addLineRange(ranges, lineStart, lineEnd);
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }
}

/** Find Markdown regions where inserting display-only text would change syntax or content. */
function protectedMarkdownRanges(markdown: string, inlineCodeSpans: InlineCodeSpan[]): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];

  // Fences are recognized after removing blockquote/list containers. This
  // covers nested fences and unfinished streaming fences without trying to
  // reproduce the full block parser.
  let fence: { character: string; length: number } | undefined;
  let lineStart = 0;
  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd);
    const content = containerContent(line);
    if (fence) {
      addLineRange(ranges, lineStart, lineEnd);
      const close = new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`).test(content);
      if (close) fence = undefined;
    } else {
      const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(content);
      // A backtick fence's info string cannot contain a backtick. Such a line
      // may instead contain an inline code span, for example ```#fff```.
      const validOpening = opening && (opening[2][0] !== "`" || !opening[3].includes("`"));
      if (validOpening) {
        addLineRange(ranges, lineStart, lineEnd);
        fence = { character: opening[2][0], length: opening[2].length };
      } else if (/^(?: {4}|\t)/.test(line) || /^(?: {4}|\t)/.test(content)) {
        addLineRange(ranges, lineStart, lineEnd);
      }
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }

  protectHTML(markdown, ranges);

  // Inline code spans are protected only when they have a closing run. An
  // unmatched backtick is rendered as text by marked, including while typing.
  // Backslashes do not escape backticks inside a code span.
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "`" || isEscaped(markdown, index) || isInRange(index, ranges)) continue;
    let runEnd = index + 1;
    while (markdown[runEnd] === "`") runEnd += 1;
    const run = markdown.slice(index, runEnd);
    let close = markdown.indexOf(run, runEnd);
    while (close >= 0 && (markdown[close - 1] === "`" || markdown[close + run.length] === "`")) {
      close = markdown.indexOf(run, close + 1);
    }
    if (close >= 0) {
      const spanEnd = close + run.length;
      addRange(ranges, index, spanEnd);
      inlineCodeSpans.push({
        start: index,
        end: spanEnd,
        literalStart: runEnd,
        literalEnd: close,
      });
      index = spanEnd - 1;
    } else index = runEnd - 1;
  }

  // Balanced square-bracket spans include reference labels and shortcut links.
  // Protecting them conservatively is preferable to inserting a restore link
  // into Markdown syntax, especially for nested or multiline labels.
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "[" || isEscaped(markdown, index) || isInRange(index, ranges)) continue;
    let depth = 1;
    let close = index + 1;
    for (; close < markdown.length; close += 1) {
      if (isEscaped(markdown, close)) continue;
      if (markdown[close] === "[") depth += 1;
      else if (markdown[close] === "]" && --depth === 0) break;
    }
    if (depth === 0) {
      addRange(ranges, index, close + 1);
      index = close;
    }
  }

  // Inline link destinations, including titles, must remain byte-for-byte
  // unchanged. Labels are protected as part of the link so the restore marker
  // can never create a nested link.
  for (let index = 0; index + 1 < markdown.length; index += 1) {
    if (markdown[index] !== "]" || markdown[index + 1] !== "(") continue;
    let depth = 1;
    let close = index + 2;
    for (; close < markdown.length; close += 1) {
      if (isEscaped(markdown, close)) continue;
      if (markdown[close] === "(") depth += 1;
      else if (markdown[close] === ")" && --depth === 0) break;
    }
    let labelStart = index - 1;
    while (labelStart >= 0 && markdown[labelStart] !== "\n" && markdown[labelStart] !== "[") labelStart -= 1;
    addRange(ranges, Math.max(0, labelStart), depth === 0 ? close + 1 : markdown.indexOf("\n", index) < 0 ? markdown.length : markdown.indexOf("\n", index));
    if (depth === 0) index = close;
  }

  // Reference definitions are not rendered as text. Do not consume the
  // newline: otherwise an adjacent definition is skipped. Indented following
  // lines are possible continuation titles and are protected as well.
  lineStart = 0;
  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd);
    if (/^ {0,3}\[(?:\\.|[^\\\]\n])+\]:/.test(line)) {
      addRange(ranges, lineStart, lineEnd);
      let continuationStart = newline < 0 ? markdown.length + 1 : newline + 1;
      while (continuationStart <= markdown.length) {
        const continuationNewline = markdown.indexOf("\n", continuationStart);
        const continuationEnd = continuationNewline < 0 ? markdown.length : continuationNewline;
        const continuation = markdown.slice(continuationStart, continuationEnd);
        if (continuation.length === 0 || !/^(?:[ \t]+)/.test(continuation)) break;
        addRange(ranges, continuationStart, continuationEnd);
        if (continuationNewline < 0) {
          continuationStart = markdown.length + 1;
          break;
        }
        continuationStart = continuationNewline + 1;
      }
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }

  // Autolinks and ordinary URLs can contain a color-looking URL fragment.
  for (const match of markdown.matchAll(/<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>/g)) {
    if (!isInRange(match.index!, ranges)) addRange(ranges, match.index!, match.index! + match[0].length);
  }
  for (const match of markdown.matchAll(/(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/|www\.)[^\s<>()]+/g)) {
    if (!isInRange(match.index!, ranges)) addRange(ranges, match.index!, match.index! + match[0].length);
  }

  return ranges;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}\p{M}$#-]/u.test(character);
}

function hasEmphasisBoundary(markdown: string, index: number, before: boolean): boolean {
  if (markdown[index] !== "_") return true;
  let edge = index;
  if (before) {
    while (edge > 0 && markdown[edge - 1] === "_") edge -= 1;
    return !isIdentifierCharacter(markdown[edge - 1]);
  }
  while (edge < markdown.length && markdown[edge] === "_") edge += 1;
  return !isIdentifierCharacter(markdown[edge]);
}

function hasSafeBoundaries(markdown: string, start: number, end: number): boolean {
  const previous = markdown[start - 1];
  const next = markdown[end];
  return !isIdentifierCharacter(previous) && !isIdentifierCharacter(next)
    && hasEmphasisBoundary(markdown, start - 1, true)
    && hasEmphasisBoundary(markdown, end, false);
}

function isIncompleteStreamingHex(literal: string, end: number, length: number, isStreaming: boolean): boolean {
  return isStreaming && end === length && literal.startsWith("#") && [4, 5, 7].includes(literal.length);
}

// The prefix is part of the match so a boundary character can be copied exactly.
const CANDIDATE_RE = /(^|[^\p{L}\p{N}\p{M}$#-])(?:#[\da-f]{3,8}|rgba?\([^()]*\))(?![\p{L}\p{N}\p{M}$#-])/giu;

export interface TransformOptions {
  isStreaming: boolean;
  trueColor: boolean;
}

/** Add terminal-only swatches while preserving Markdown syntax and source literals. */
export function transformColors(markdown: string, options: TransformOptions): string {
  const inlineCodeSpans: InlineCodeSpan[] = [];
  const protectedRanges = protectedMarkdownRanges(markdown, inlineCodeSpans);
  const insertions: { position: number; text: string }[] = [];

  // A code span is eligible only when its complete source content is one color
  // literal. Other code spans remain byte-for-byte protected, and spans inside
  // another protected construct (such as a link destination) stay protected too.
  for (const span of inlineCodeSpans) {
    const protectedByOtherSyntax = protectedRanges.some((range) =>
      !(range.start === span.start && range.end === span.end)
      && range.start < span.end && range.end > span.start,
    );
    if (protectedByOtherSyntax) continue;

    const sourceContent = markdown.slice(span.literalStart, span.literalEnd);
    // CommonMark converts line endings to spaces, then removes one surrounding
    // space when both ends are spaces. Match that normalization while leaving
    // the original source untouched.
    const normalizedContent = sourceContent.replace(/\r\n?|\n/g, " ");
    const literal = normalizedContent.length > 1
      && normalizedContent.startsWith(" ")
      && normalizedContent.endsWith(" ")
      && /[^ ]/.test(normalizedContent)
      ? normalizedContent.slice(1, -1)
      : normalizedContent;
    const parsed = parseColorLiteral(literal);
    if (!parsed || isIncompleteStreamingHex(literal, span.literalEnd, markdown.length, options.isStreaming)) continue;
    if (ANSI_DECORATION_RE.test(markdown.slice(span.end))) continue;
    insertions.push({
      position: span.end,
      text: decoration(parsed, options.trueColor, span.end < markdown.length || parsed.alpha !== undefined),
    });
  }

  for (const match of markdown.matchAll(CANDIDATE_RE)) {
    const full = match[0];
    const prefix = match[1];
    const literal = full.slice(prefix.length);
    const start = match.index!;
    const literalStart = start + prefix.length;
    const end = literalStart + literal.length;
    const parsed = parseColorLiteral(literal);

    if (!parsed || !hasSafeBoundaries(markdown, literalStart, end)
      || isInRange(literalStart, protectedRanges)
      || isIncompleteStreamingHex(literal, end, markdown.length, options.isStreaming)) continue;
    if (ANSI_DECORATION_RE.test(markdown.slice(end))) continue;
    insertions.push({
      position: end,
      text: decoration(parsed, options.trueColor, end < markdown.length || parsed.alpha !== undefined),
    });
  }

  if (insertions.length === 0) return markdown;
  insertions.sort((left, right) => left.position - right.position);
  let result = "";
  let lastIndex = 0;
  for (const insertion of insertions) {
    result += markdown.slice(lastIndex, insertion.position) + insertion.text;
    lastIndex = insertion.position;
  }
  return result + markdown.slice(lastIndex);
}
