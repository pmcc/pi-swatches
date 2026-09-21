import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";
import { transformColors } from "./colors.ts";

export { alphaPercent, parseColorLiteral, transformColors } from "./colors.ts";

export default function registerMarkdownTransformer(pi: ExtensionAPI): void {
  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType === "assistant-thinking") return markdown;
    return transformColors(markdown, {
      isStreaming: context.isStreaming,
      trueColor: getCapabilities().trueColor,
    });
  });
}
