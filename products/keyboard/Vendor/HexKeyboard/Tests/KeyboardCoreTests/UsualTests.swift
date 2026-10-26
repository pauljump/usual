import Testing
@testable import KeyboardCore
struct UsualTests {
    @Test func predictionsCannotStealVisibleKeys() {
        let grid = KeyGrid(Layouts.layout(for: LayoutContext(device: .phone, layer: .letters)),
                           width: 402, metrics: KeyboardMetrics.phone(width: 402).grid, signature: "phone")
        let corrector = Corrector(source: testLexicon)
        corrector.grid = grid
        for prefix in ["", "h", "hell", "usual", "pj", "zz"] {
            let map = corrector.keyMap(revision: 0, after: prefix)
            for (r, row) in grid.rows.enumerated() {
                for (k, item) in row.enumerated() {
                    for u in [0.01, 0.5, 0.99] {
                        for v in [0.01, 0.5, 0.99] {
                            let hit = map.key(atX: item.frame.x + u * item.frame.width,
                                              y: item.frame.y + v * item.frame.height, in: grid)
                            #expect(hit?.row == r && hit?.key == k)
                        }
                    }
                }
            }
        }
    }
    @Test func replacesWholeDraftWithCursorInMiddle() {
        var engine = TypingEngine()
        let doc = TestDocument("hello 👋🏽 sloppy draft")
        doc.cursor = 6
        engine.documentChanged(doc)
        engine.replaceKnownDraft(with: "hello 👋🏽 clean draft", in: doc)
        #expect(doc.text == "hello 👋🏽 clean draft")
        #expect(engine.text.before == doc.text)
    }
    @Test func retainsLongTypedDraft() {
        var engine = TypingEngine()
        let doc = TestDocument()
        engine.type(String(repeating: "hello ", count: 80), in: doc)
        engine.replaceKnownDraft(with: "short draft", in: doc)
        #expect(doc.text == "short draft")
    }
    @Test func splitKeepsRealWordsAndUserSlang() {
        let lexicon = Lexicon(counts: [(word: "bring",count: 20.0),(word: "you",count: 50.0),(word: "some",count: 20.0),(word: "someone",count: 10.0)])
        let corrector = Corrector(source: lexicon)
        corrector.memory.record("bring", after: nil)
        corrector.memory.record("you", after: "bring")
        #expect(corrector.correction(for: TypedWord("bringcyou")) == "bring you")
        #expect(corrector.correction(for: TypedWord("someone")) == nil)
        corrector.memory.keep("bringcyou")
        #expect(corrector.correction(for: TypedWord("bringcyou")) == nil)
    }
}

struct UsualAutocorrectResearchTests {
    private var corrector: Corrector {
        let lexicon = Lexicon(counts: [("keyboard", 20.0), ("that", 100), ("is", 100), ("some", 80),
                                      ("reason", 20), ("had", 70), ("didn't", 60), ("realize", 30),
                                      ("but", 80), ("I", 100), ("someone", 40), ("minimum", 30)]
            .map { (word: $0.0, count: $0.1) })
        let corrector = Corrector(source: lexicon)
        corrector.memory.record("keyboard", after: nil)
        return corrector
    }

    @Test func repairsMultipleSpaceLettersAndContractions() {
        let c = corrector
        #expect(c.correction(for: TypedWord("keyboardnthatbis")) == "keyboard that is")
        #expect(c.correction(for: TypedWord("somecreasonbhad")) == "some reason had")
        #expect(c.correction(for: TypedWord("Didn’tvrealize")) == "Didn’t realize")
        #expect(c.correction(for: TypedWord("butcI"))?.lowercased() == "but i")
        #expect(c.correction(for: TypedWord("someone")) == nil)
        #expect(c.correction(for: TypedWord("minimum")) == nil)
        c.memory.keep("keyboardnthatbis")
        #expect(c.correction(for: TypedWord("keyboardnthatbis")) == nil)
    }

    @Test func splitRespectsLiteralFieldsAndCanBeReverted() {
        var engine = TypingEngine()
        engine.settings.autoCapitalization = false
        engine.corrector = corrector
        let doc = TestDocument()
        engine.type("keyboardnthatbis ", in: doc)
        #expect(doc.text == "keyboard that is ")
        engine.perform(.delete, in: doc)
        #expect(engine.suggestions.contains { $0.text == "keyboardnthatbis" })
        if let undo = engine.suggestions.first(where: { $0.text == "keyboardnthatbis" }) { engine.accept(undo, in: doc) }
        #expect(doc.text == "keyboardnthatbis ")
        var literal = TypingEngine(traits: InputTraits(autocorrection: false))
        literal.settings.autoCapitalization = false
        literal.corrector = corrector
        let field = TestDocument()
        literal.type("keyboardnthatbis ", in: field)
        #expect(field.text == "keyboardnthatbis ")
    }
}
