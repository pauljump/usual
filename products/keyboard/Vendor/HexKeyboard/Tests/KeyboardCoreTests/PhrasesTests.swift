import Testing
@testable import KeyboardCore

let testPhrases = Phrases(contexts: [
    .init(words: ["want"], total: 100, types: 10, next: [("to", 60), ("you", 20), ("a", 10)]),
    .init(words: ["i", "want"], total: 50, types: 5, next: [("you", 30), ("to", 15)]),
    .init(words: ["_start_"], total: 100, types: 20, next: [("I", 40), ("the", 20)]),
    .init(words: ["thank"], total: 10, types: 2, next: [("you", 9)]),
])

struct PhrasesTests {
    @Test func findsEveryWordItStores() {
        for word in ["_start_", "a", "i", "the", "thank", "to", "want", "you"] {
            #expect(testPhrases.id(of: word).map(testPhrases.spelling(of:)) == word)
        }
        #expect(testPhrases.id(of: "I") == testPhrases.id(of: "i"))
        #expect(testPhrases.id(of: "wan") == nil)
        #expect(testPhrases.id(of: "wants") == nil)
        #expect(testPhrases.id(of: "zebra") == nil)
    }

    @Test func nextWordsComeFromTheLongestContextFirst() {
        #expect(testPhrases.next(after: "want", earlier: "i") == ["you", "to", "to", "you", "a"])
        #expect(testPhrases.next(after: "want", earlier: "they") == ["to", "you", "a"])
        #expect(testPhrases.next(after: "", earlier: nil) == ["i", "the"])
        #expect(testPhrases.next(after: nil, earlier: nil).isEmpty)
    }

    @Test func probabilityBacksOffByWittenBellWeights() {
        let bigram = 100.0 / 110
        let alone = testPhrases.probability(of: "to", after: "want", earlier: nil, below: 0.01)
        #expect(abs(alone - (bigram * 0.6 + (1 - bigram) * 0.01)) < 0.01)
        let trigram = 50.0 / 55
        let after = testPhrases.probability(of: "you", after: "want", earlier: "i", below: 0.01)
        #expect(abs(after - (trigram * 0.6 + (1 - trigram) * (bigram * 0.2 + (1 - bigram) * 0.01))) < 0.01)
        #expect(testPhrases.probability(of: "zebra", after: "want", earlier: nil, below: 0.01) < 0.01)
        #expect(testPhrases.probability(of: "to", after: nil, earlier: nil, below: 0.01) == 0.01)
    }

    @Test func predictionsFollowThePhrase() {
        let corrector = Corrector(source: testLexicon, phrases: testPhrases)
        #expect(corrector.predictions(after: "want", earlier: "i", context: "i want ").map(\.text) == ["you", "to", "a"])
        #expect(corrector.predictions(after: "", earlier: nil, context: "").first?.text == "I")
    }

    @Test func predictionsAreCapitalizedWhereTheNextWordIs() {
        var engine = TypingEngine()
        engine.corrector = Corrector(source: testLexicon, phrases: testPhrases)
        let document = TestDocument()
        engine.documentChanged(document)
        engine.suggestionsChanged()
        #expect(engine.suggestions.map(\.text).prefix(2) == ["I", "The"])
        for character in "want " { engine.perform(character == " " ? .space : .character(String(character)), in: document) }
        #expect(engine.suggestions.map(\.text).prefix(2) == ["to", "you"])
    }

    @Test func contextReadsTwoWordsBack() {
        let text = "Hi. I want "
        let word = Words.current(in: text)
        #expect(Words.context(before: word, in: text) == ("want", "i"))
        let start = "Hi. I "
        #expect(Words.context(before: Words.current(in: start), in: start) == ("i", ""))
        #expect(Words.context(before: Words.current(in: "Hi. "), in: "Hi. ") == ("", nil))
    }
}
