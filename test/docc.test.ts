import { describe, expect, it } from "vitest";
import { doccDataUrl, renderDocc } from "../src/docc.js";
import { PageFetcher } from "../src/fetcher.js";
import { FakeWeb } from "./helpers.js";

const doc = {
  metadata: { title: "purchase(options:)", roleHeading: "Instance Method" },
  abstract: [{ type: "text", text: "Initiates a purchase for the product." }],
  primaryContentSections: [
    { kind: "declarations", declarations: [{ tokens: [{ text: "func " }, { text: "purchase" }, { text: "(options: Set<Product.PurchaseOption>) async throws -> Product.PurchaseResult" }] }] },
    { kind: "parameters", parameters: [{ name: "options", content: [{ type: "paragraph", inlineContent: [{ type: "text", text: "Options for the purchase." }] }] }] },
    {
      kind: "content",
      content: [
        { type: "heading", level: 2, text: "Discussion" },
        { type: "paragraph", inlineContent: [{ type: "text", text: "Prefer " }, { type: "reference", identifier: "doc://x/PurchaseAction" }, { type: "text", text: " in SwiftUI." }] },
        { type: "codeListing", syntax: "swift", code: ["let result = try await product.purchase()"] },
        { type: "aside", name: "Important", content: [{ type: "paragraph", inlineContent: [{ type: "text", text: "Call finish() on every transaction." }] }] },
        { type: "unorderedList", items: [{ content: [{ type: "paragraph", inlineContent: [{ type: "codeVoice", code: "success" }] }] }] },
      ],
    },
  ],
  topicSections: [{ title: "Results", identifiers: ["doc://x/PurchaseAction"] }],
  references: { "doc://x/PurchaseAction": { title: "PurchaseAction", kind: "symbol", url: "/documentation/storekit/purchaseaction", abstract: [{ type: "text", text: "An action that starts a purchase." }] } },
};

describe("Apple DocC pages", () => {
  it("maps docs pages to their JSON and leaves other pages alone", () => {
    expect(doccDataUrl("https://developer.apple.com/documentation/StoreKit/Product")).toBe("https://developer.apple.com/tutorials/data/documentation/storekit/product.json");
    expect(doccDataUrl("https://developer.apple.com/design/human-interface-guidelines/buttons")).toBe("https://developer.apple.com/tutorials/data/design/human-interface-guidelines/buttons.json");
    expect(doccDataUrl("https://developer.apple.com/app-store/review/guidelines")).toBeNull();
    expect(doccDataUrl("https://example.com/documentation/x")).toBeNull();
  });

  it("renders declarations, prose, code, asides and topics", () => {
    const { title, text } = renderDocc(doc);
    expect(title).toBe("purchase(options:)");
    expect(text).toContain("```swift\nfunc purchase(options: Set<Product.PurchaseOption>)");
    expect(text).toContain("- `options`: Options for the purchase.");
    expect(text).toContain("Prefer `PurchaseAction` in SwiftUI.");
    expect(text).toContain("```swift\nlet result = try await product.purchase()\n```");
    expect(text).toContain("> Important: Call finish() on every transaction.");
    expect(text).toContain("- `PurchaseAction`: An action that starts a purchase.");
  });

  it("reads the JSON behind the page and falls back to HTML when there is none", async () => {
    const web = new FakeWeb();
    web.pages.set("https://developer.apple.com/tutorials/data/documentation/storekit/product/purchase(options:).json", { type: "application/json", body: JSON.stringify(doc) });
    const fetcher = new PageFetcher(web.fetch);
    const page = await fetcher.fetchPage("https://developer.apple.com/documentation/storekit/product/purchase(options:)");
    expect(page.title).toBe("purchase(options:)");
    expect(page.url).toBe("https://developer.apple.com/documentation/storekit/product/purchase(options:)");

    web.pages.set("https://developer.apple.com/documentation/old-page", { body: `<html><body><main><p>${"Archived page text. ".repeat(10)}</p></main></body></html>` });
    expect((await fetcher.fetchPage("https://developer.apple.com/documentation/old-page")).text).toContain("Archived page text.");
  });
});
