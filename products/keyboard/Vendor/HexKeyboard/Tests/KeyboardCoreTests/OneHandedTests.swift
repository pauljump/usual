import Testing
@testable import KeyboardCore

struct OneHandedTests {
    private func grid(_ hand: OneHanded, width: Double) -> KeyGrid {
        let context = LayoutContext(device: .phone, layer: .letters, oneHanded: hand)
        let metrics = KeyboardMetrics.for(.phone, width: width, height: 874, oneHanded: context.oneHanded)
        return KeyGrid(Layouts.layout(for: context), width: width, metrics: metrics.grid, signature: context.signature)
    }

    private func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) <= 1.0 / 3 }

    @Test func keysMatchApplesOneHandedKeyboard() {
        for width in [390.0, 402, 440] {
            let left = grid(.left, width: width)
            #expect(near(left.frame(of: "q")!.x, 4) && near(left.frame(of: "q")!.width, 25.8), "\(width)")
            #expect(near(left.frame(of: "p")!.x + left.frame(of: "p")!.width, 316), "\(width)")
            #expect(near(left.frame(of: "a")!.x, 20), "\(width)")
            let right = grid(.right, width: width)
            #expect(near(right.frame(of: "q")!.x, width - 318) && near(right.frame(of: "q")!.width, 26), "\(width)")
            #expect(near(right.frame(of: "p")!.x + right.frame(of: "p")!.width, width - 4), "\(width)")
        }
    }

    @Test func chevronSitsWhereApplesDoes() {
        let left = grid(.left, width: 402).expander
        #expect(left?.pointsRight == true)
        #expect(near(left!.frame.x, 362) && near(left!.frame.y - 8, 687 - 598))
        let right = grid(.right, width: 440).expander
        #expect(right?.pointsRight == false && near(right!.frame.x, 27.67))
        #expect(grid(.off, width: 402).expander == nil)
    }

    @Test func onlyUprightPhonesNarrow() {
        #expect(LayoutContext(device: .phone, layer: .letters, isLandscape: true, oneHanded: .left).oneHanded == .off)
        #expect(LayoutContext(device: .pad, layer: .letters, oneHanded: .right).oneHanded == .off)
        #expect(LayoutContext(device: .phone, layer: .numbers, oneHanded: .right).oneHanded == .right)
    }

    @Test func eachHandLearnsItsOwnTaps() {
        let context = LayoutContext(device: .phone, layer: .letters, oneHanded: .left)
        #expect(context.signature == "phone-portrait-letters-left")
        #expect(LayoutContext(signature: context.signature) == context)
        #expect(LayoutContext(device: .phone, layer: .letters).signature == "phone-portrait-letters")
    }

    @Test func holdingTheLayerKeyOffersHands() {
        let context = LayoutContext(device: .phone, layer: .letters)
        #expect(context.oneHandedKey(in: Layouts.layout(for: context))?.action == .layer(.numbers))
        let numbers = LayoutContext(device: .phone, layer: .numbers)
        #expect(numbers.oneHandedKey(in: Layouts.layout(for: numbers))?.action == .layer(.letters))
        let pad = LayoutContext(device: .pad, layer: .letters)
        #expect(pad.oneHandedKey(in: Layouts.layout(for: pad)) == nil)
    }

    @Test func pickingAHandBringsTheLettersBack() {
        var engine = TypingEngine()
        let document = TestDocument()
        let numbers = Key(.layer(.numbers))
        engine.handle(.down(numbers, tapCount: 1), in: document)
        #expect(engine.layer == .numbers)
        engine.handle(.pickHand(.right), in: document)
        #expect(engine.layer == .letters && engine.settings.oneHanded == .right)
        #expect(engine.layout(on: .phone).oneHanded == .right)
        engine.handle(.oneHanded(.off), in: document)
        #expect(engine.settings.oneHanded == .off && engine.layer == .letters)
    }
}
