import assert from "node:assert/strict";
import test from "node:test";
import { Markdown, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import registerMarkdownTransformer, {
  alphaPercent,
  parseColorLiteral,
  transformColors,
} from "../dist/index.js";

const TRUECOLOR = { images: null, trueColor: true, hyperlinks: false };
const ANSI256 = { images: null, trueColor: false, hyperlinks: false };

function transform(text: string, isStreaming = false, trueColor = true): string {
  return transformColors(text, { isStreaming, trueColor });
}

test("parses hex forms while preserving the source spelling at transform time", () => {
  assert.deepEqual(parseColorLiteral("#AbC"), { rgb: [170, 187, 204] });
  assert.deepEqual(parseColorLiteral("#1234"), { rgb: [17, 34, 51], alpha: 68 / 255 });
  assert.deepEqual(parseColorLiteral("#aBcDeF80"), {
    rgb: [171, 205, 239],
    alpha: 128 / 255,
  });
  assert.equal(transform("#AbC", false), "#AbC \u001b[38;2;170;187;204m■\u001b[39m");
});

test("parses comma and modern rgb/rgba syntax", () => {
  assert.deepEqual(parseColorLiteral("rgb(10, 20, 30)"), { rgb: [10, 20, 30] });
  assert.deepEqual(parseColorLiteral("rgba(10,20,30,.5)"), {
    rgb: [10, 20, 30],
    alpha: 0.5,
  });
  assert.deepEqual(parseColorLiteral("RGB(50% 0% 100% / 25%)"), {
    rgb: [128, 0, 255],
    alpha: 0.25,
  });
  assert.deepEqual(parseColorLiteral("rgba(1 2 3 / 0.005)"), {
    rgb: [1, 2, 3],
    alpha: 0.005,
  });
  assert.equal(transform("rgba(10,20,30,.5)"), "rgba(10,20,30,.5) \u001b[38;2;10;20;30m■\u001b[39m[]() 50%");
});

test("rejects invalid ranges and unsupported forms", () => {
  for (const value of [
    "#12345",
    "#123456789",
    "rgb(256, 0, 0)",
    "rgb(10.5, 0, 0)",
    "rgb(101% 0% 0%)",
    "rgba(0 0 0 / 1.01)",
    "rgba(0 0 0 / -1%)",
    "rgb(0, 0, 0, .5, .2)",
    "rgb(0 0 0 .5)",
  ]) {
    assert.equal(parseColorLiteral(value), undefined, value);
    assert.equal(transform(value), value, value);
  }
});

test("uses sensible identifier and longer-run boundaries", () => {
  const input = "foo#fff #12345 #fff_bar #fff-thing ##fff #fff, #000.";
  const output = transform(input);
  assert.equal(output, "foo#fff #12345 #fff_bar #fff-thing ##fff #fff \u001b[38;2;255;255;255m■\u001b[39m[](), #000 \u001b[38;2;0;0;0m■\u001b[39m[]().");
});

test("protects Markdown destinations, references, autolinks, and URL fragments", () => {
  const cases = [
    "[color](#fff)",
    "[color](https://example.test/#fff)",
    "[color][white]\n\n[white]: #fff",
    "[red #fff][color]",
    "[#fff]\n\n[#fff]: /target",
    "[a]: /first\n[b]: #fff",
    "[a]: /first\n  \"#fff title\"",
    "[color][white]\n\n   [white]: <https://example.test/#fff> \"#000 title\"",
    "<https://example.test/#fff>",
    "https://example.test/path/#fff",
    "www.example.test/#fff",
  ];
  for (const input of cases) assert.equal(transform(input), input, input);

  const mixed = "#000 https://example.test/#fff #fff";
  const output = transform(mixed);
  assert.match(output, /^#000 .*https:\/\/example\.test\/#fff #fff /);
  assert.equal((output.match(/38;2;/g) ?? []).length, 2);
});

test("does not rewrite inline, indented, or fenced code", () => {
  const input = [
    "`#fff` and `rgba(1, 2, 3, .5)`",
    "",
    "```css",
    "#000",
    "```",
    ">     #fff",
    "-     rgba(1, 2, 3, .5)",
    "> -     #000",
    "> ```css",
    "> #fff",
    "> ```",
    "`#fff\\`",
  ].join("\n");
  assert.equal(transform(input), input);
});

test("protects HTML tags and raw HTML blocks", () => {
  const tag = '<span style="color: #fff">text</span>';
  const block = "<div>\n#fff\n</div>";
  assert.equal(transform(tag), tag);
  assert.equal(transform(block), block);

  const style = (text: string) => text;
  const theme = {
    heading: style,
    link: style,
    linkUrl: style,
    code: style,
    codeBlock: style,
    codeBlockBorder: style,
    quote: style,
    quoteBorder: style,
    hr: style,
    listBullet: style,
    bold: style,
    italic: style,
    strikethrough: style,
    underline: style,
  };
  for (const input of [tag, block]) {
    const rendered = new Markdown(transform(input), 0, 0, theme, { color: style }).render(80).join("\\n");
    assert.doesNotMatch(rendered, /\\[\\]\\(\\)/, input);
  }
});

test("accepts emphasis delimiters without accepting identifier underscores", () => {
  assert.notEqual(transform("__#fff__"), "__#fff__");
  assert.notEqual(transform("_rgba(1, 2, 3, .5)_"), "_rgba(1, 2, 3, .5)_");
  assert.equal(transform("foo_#fff #fff_bar"), "foo_#fff #fff_bar");
});

test("renders multiple colors and alpha labels", () => {
  assert.equal(
    transform("#00000000, #fff, rgb(255 0 0 / 50.5%)"),
    "#00000000 \u001b[38;2;0;0;0m■\u001b[39m[]() 0%, #fff \u001b[38;2;255;255;255m■\u001b[39m[](), rgb(255 0 0 / 50.5%) \u001b[38;2;255;0;0m■\u001b[39m[]() 51%",
  );
  assert.equal(alphaPercent(0), 0);
  assert.equal(alphaPercent(0.5), 50);
  assert.equal(alphaPercent(0.505), 51);
  assert.equal(alphaPercent(0.145), 15);
  assert.equal(alphaPercent(1), 100);
});

test("uses truecolor and nearest ANSI-256 rendering", () => {
  setCapabilities(TRUECOLOR);
  assert.equal(
    transformColors("#ff0000", { isStreaming: false, trueColor: true }),
    "#ff0000 \u001b[38;2;255;0;0m■\u001b[39m",
  );
  setCapabilities(ANSI256);
  assert.equal(
    transformColors("#ff0000", { isStreaming: false, trueColor: false }),
    "#ff0000 \u001b[38;5;196m■\u001b[39m",
  );
});

test("continues styles through rendered swatches", () => {
  const style = (code: string) => (text: string) => `\u001b[${code}m${text}\u001b[39m`;
  const theme = {
    heading: style("38;5;33"),
    link: style("4"),
    linkUrl: style("2"),
    code: style("32"),
    codeBlock: style("32"),
    codeBlockBorder: (text: string) => text,
    quote: style("36"),
    quoteBorder: (text: string) => text,
    hr: (text: string) => text,
    listBullet: (text: string) => text,
    bold: style("1"),
    italic: style("3"),
    strikethrough: style("9"),
    underline: style("4"),
  };
  const defaultTextStyle = { color: style("38;5;45") };
  setCapabilities(TRUECOLOR);
  const plain = new Markdown(transform("before #fff after"), 0, 0, theme, defaultTextStyle).render(80)[0]!;
  const heading = new Markdown(transform("# Heading #fff after"), 0, 0, theme, defaultTextStyle).render(80)[0]!;
  assert.match(plain, /\u001b\[38;5;45m after/);
  assert.match(heading, /\u001b\[38;5;33m(?:\u001b\[[0-9;]+m)+ after/);
  const alphaAtEnd = new Markdown(transform("rgba(1, 2, 3, .5)"), 0, 0, theme, defaultTextStyle).render(80)[0]!;
  assert.match(alphaAtEnd, /\u001b\[38;5;45m 50%/);
  assert.doesNotMatch(plain, /\[\]\(\)/);
  assert.doesNotMatch(heading, /\[\]\(\)/);

  const narrow = new Markdown(transform("before #fff after #000"), 0, 0, theme, defaultTextStyle).render(12);
  assert.ok(narrow.length > 1);
  for (const line of narrow) assert.ok(visibleWidth(line) <= 12, line);
});

test("does not expose restore links when hyperlinks are enabled", () => {
  const style = (text: string) => text;
  const theme = {
    heading: style,
    link: style,
    linkUrl: style,
    code: style,
    codeBlock: style,
    codeBlockBorder: style,
    quote: style,
    quoteBorder: style,
    hr: style,
    listBullet: style,
    bold: style,
    italic: style,
    strikethrough: style,
    underline: style,
  };
  setCapabilities({ ...TRUECOLOR, hyperlinks: true });
  const rendered = new Markdown(transform("before #fff after"), 0, 0, theme, { color: style }).render(80).join("\n");
  assert.doesNotMatch(rendered, /\[\]\(\)/);
  assert.equal(visibleWidth(rendered.trimEnd()), "before #fff ■ after".length);
  setCapabilities(TRUECOLOR);
});

test("holds ambiguous terminal hex chunks during streaming", () => {
  assert.equal(transform("#abc", true), "#abc");
  assert.equal(transform("#abcd", true), "#abcd");
  assert.equal(transform("#abcdef", true), "#abcdef");
  assert.equal(transform("#abcdef00", true), "#abcdef00 \u001b[38;2;171;205;239m■\u001b[39m[]() 0%");
  assert.notEqual(transform("#abc.", true), "#abc.");
  assert.notEqual(transform("#abc ", true), "#abc ");

  const snapshots = ["#abc", "#abcdef", "#abcdef0", "#abcdef00"];
  assert.equal(transform(snapshots[0]!, true), snapshots[0]);
  assert.equal(transform(snapshots[1]!, true), snapshots[1]);
  assert.equal(transform(snapshots[2]!, true), snapshots[2]);
  const finalized = transform(snapshots[3]! + " ", false);
  assert.notEqual(finalized, snapshots[3]! + " ");
  assert.equal(transform(finalized), finalized);
});

test("is idempotent and leaves assistant thinking unchanged", () => {
  const once = transform("Color #ABCDEF80");
  assert.equal(transform(once), once);

  let registered: ((markdown: string, context: { messageType: string; isStreaming: boolean; availableWidth: number }) => string) | undefined;
  registerMarkdownTransformer({
    registerMarkdownTransformer(transformer: typeof registered) {
      registered = transformer;
    },
  } as never);
  assert.ok(registered);
  const thinking = "Thinking about #fff";
  assert.equal(registered!(thinking, { messageType: "assistant-thinking", isStreaming: true, availableWidth: 80 }), thinking);

  setCapabilities(TRUECOLOR);
  assert.notEqual(registered!("Answer #fff", { messageType: "assistant", isStreaming: false, availableWidth: 80 }), "Answer #fff");
});
