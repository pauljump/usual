import Testing
@testable import KeyboardCore

struct SwipeEngineTests {
    @Test func contractionsFollowLetterPathAndKeepApostrophe() {
        let keys = KeyGrid.standard.swipeKeys
        let decoder = LocalSwipeDecoder(words: [SwipeWord(word: "don't", frequency: 100)], contractions: true)
        let samples = Array("dont").enumerated().map { index, c in
            let key = keys.first { $0.letter == String(c) }!
            return SwipeSample(x: key.x, y: key.y, time: Double(index) * 0.1)
        }
        #expect(decoder.decode(samples: samples, keys: keys) == ["don't"])
        let doc = TestDocument()
        var e = engine(doc)
        let inserted = e.insertSwipe(["don't"], in: doc)
        #expect(inserted)
        #expect(doc.text == "Don't ")
        e.perform(.delete, in: doc)
        #expect(doc.text.isEmpty)
        let invalidInserted = e.insertSwipe(["hello world", "'no", "no'", "🤔"], in: doc)
        #expect(!invalidInserted)
    }

    @Test func contextBreaksAmbiguousShapesWithoutOverridingDistantGesture() {
        let lexicon = Lexicon(counts: ["were", "we're", "hello", "they", "we"].map { (word: $0, count: 100.0) })
        var memory = TypingMemory()
        for _ in 0..<30 { memory.record("were", after: "they"); memory.record("we're", after: "now") }
        let decoder = LocalSwipeDecoder(words: lexicon.swipeWords, contractions: true)
        let keys = KeyGrid.standard.swipeKeys
        func path(_ word: String) -> [SwipeSample] {
            word.enumerated().map { i, c in
                let key = keys.first { $0.letter == String(c) }!
                return SwipeSample(x: key.x, y: key.y, time: Double(i) * 0.1)
            }
        }
        let past = SwipeLanguageContext(lexicon: lexicon, memory: memory, precedingText: "they ")
        let now = SwipeLanguageContext(lexicon: lexicon, memory: memory, precedingText: "now ")
        #expect(decoder.decode(samples: path("were"), keys: keys, context: past).first == "were")
        #expect(decoder.decode(samples: path("were"), keys: keys, context: now).first == "we're")
        #expect(decoder.decode(samples: path("helo"), keys: keys, context: now).first == "hello")
        #expect(SwipeLanguageContext(lexicon: lexicon, memory: memory, precedingText: "they").previous == "they")
        #expect(SwipeLanguageContext(lexicon: lexicon, memory: memory, precedingText: "they. ").previous == "")
    }

    private func engine(_ doc: TestDocument) -> TypingEngine {
        var engine = TypingEngine()
        engine.corrector = Corrector(source: testLexicon)
        engine.documentChanged(doc)
        return engine
    }
    @Test func consecutiveWordsAlternativesPunctuationAndUndo() {
        let doc = TestDocument()
        var e = engine(doc)
        let inserted13 = e.insertSwipe(["hello", "help"], in: doc)
        #expect(inserted13)
        #expect(doc.text == "Hello ")
        e.accept(Suggestion("Help", .swipe), in: doc)
        #expect(doc.text == "Help ")
        e.perform(.delete, in: doc)
        #expect(doc.text.isEmpty)
        let inserted19 = e.insertSwipe(["hello"], in: doc)
        #expect(inserted19)
        let inserted20 = e.insertSwipe(["world"], in: doc)
        #expect(inserted20)
        #expect(doc.text == "Hello world ")
        e.perform(.character("!"), in: doc)
        #expect(doc.text == "Hello world!")
        e.insertSwipe(["hello"], in: doc)
        #expect(doc.text == "Hello world! Hello ")
        e.perform(.return, in: doc)
        #expect(doc.text == "Hello world! Hello\n")
    }
    @Test func tapsAfterSwipeResumeNormalDeletion() {
        let doc = TestDocument()
        var e = engine(doc)
        e.insertSwipe(["hello"], in: doc)
        e.perform(.space, in: doc)
        #expect(doc.text == "Hello ")
        e.perform(.character("a"), in: doc)
        e.perform(.delete, in: doc)
        #expect(doc.text == "Hello ")
        e.perform(.delete, in: doc)
        #expect(doc.text == "Hello")
    }
    @Test func knownTappedWordSeparatesAndUndoRestoresIt() {
        let doc = TestDocument()
        var e = engine(doc)
        e.type("a", in: doc)
        let inserted41 = e.insertSwipe(["hello"], in: doc)
        #expect(inserted41)
        #expect(doc.text == "A hello ")
        e.perform(.delete, in: doc)
        #expect(doc.text == "A")
    }
    @Test func partialOrExternalWordDoesNotBecomeSwipePrefix() {
        let doc = TestDocument("hel")
        var e = engine(doc)
        #expect(!e.canInsertSwipe)
        let inserted50 = !e.insertSwipe(["hello"], in: doc)
        #expect(inserted50)
        #expect(doc.text == "hel")
    }
    @Test func middleCursorPreservesSuffixAndStaleAlternativesCannotReplace() {
        let doc = TestDocument("Hello !")
        doc.cursor = 6
        var e = engine(doc)
        let inserted57 = e.insertSwipe(["world", "word"], in: doc)
        #expect(inserted57)
        #expect(doc.text == "Hello world!")
        e.accept(Suggestion("word", .swipe), in: doc)
        #expect(doc.text == "Hello word!")
        doc.text = "elsewhere"; doc.cursor = doc.text.count
        e.documentChanged(doc)
        e.accept(Suggestion("world", .swipe), in: doc)
        #expect(doc.text == "elsewhere")
    }
    @Test func automaticSwipesDoNotTrainTouchMemory() {
        let doc = TestDocument()
        var e = engine(doc)
        let memory = e.corrector!.memory
        e.insertSwipe(["hello"], in: doc)
        e.insertSwipe(["world"], in: doc)
        e.endSession()
        #expect(e.corrector!.memory == memory)
    }
    @Test func badPathsAreRejected() {
        let decoder = LocalSwipeDecoder(words: [SwipeWord(word: "hello", frequency: 100)])
        let keys = KeyGrid.standard.swipeKeys
        #expect(decoder.decode(samples: [], keys: keys).isEmpty)
        #expect(decoder.decode(samples: [.init(x: 1, y: 1, time: 0), .init(x: 1, y: 1, time: 1)], keys: keys).isEmpty)
        #expect(decoder.decode(samples: [.init(x: .nan, y: 0, time: 0), .init(x: 1, y: 1, time: 1)], keys: keys).isEmpty)
    }
}
