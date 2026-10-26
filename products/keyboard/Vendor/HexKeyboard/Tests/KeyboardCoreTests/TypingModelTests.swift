import Testing
@testable import KeyboardCore

let testLexicon = Lexicon(counts: [
    ("the", 1000), ("a", 800), ("to", 850), ("I", 900), ("of", 500), ("in", 400), ("is", 300), ("on", 300), ("if", 100),
    ("no", 200), ("go", 100), ("I'm", 100), ("don't", 80), ("done", 20), ("work", 60), ("word", 50), ("world", 30),
    ("hello", 50), ("help", 40), ("about", 40), ("out", 50), ("man", 30), ("men", 20), ("come", 30), ("home", 30), ("job", 300),
].map { (word: $0.0, count: Double($0.1)) })

private let grid = KeyGrid.standard

private func tap(_ label: String, dx: Double = 0, dy: Double = 0) -> Tap {
    let frame = grid.frame(of: label.lowercased())!
    return Tap(x: frame.midX + dx, y: frame.midY + dy, key: label)
}

private func samples(_ label: String, dx: Double, dy: Double = 0, count: Int = 30) -> [TapSample] {
    (0..<count).map { i in
        let jitter = Double(i % 5 - 2) * 0.03
        return TapSample(tap: tap(label, dx: dx + jitter, dy: dy - jitter), intended: label)
    }
}

private func type(_ text: String, into engine: inout TypingEngine, _ document: TestDocument) {
    for character in text {
        let label = String(character)
        engine.perform(label == " " ? .space : .character(label), in: document, tap: tap(label))
    }
}

struct MathTests {
    @Test func logAndExpMatchKnownValues() {
        #expect(abs(Math.log(10) - 2.302_585_092_994_046) < 1e-14)
        #expect(abs(Math.log(1e-300) + 690.775_527_898_213_7) < 1e-10)
        #expect(abs(Math.exp(1) - 2.718_281_828_459_045) < 1e-14)
        #expect(abs(Math.exp(-20) - 2.061_153_622_438_558e-9) < 1e-22)
        #expect(abs(Math.log1p(1e-12) - 1e-12) < 1e-24)
        #expect(Math.log(0) == -.infinity)
    }
}

struct TouchModelTests {
    @Test func priorIsTheDrawnKeySoItAgreesWithNearestKey() {
        let model = TouchModel()
        let n = grid.frame(of: "n")!, m = grid.frame(of: "m")!
        let boundary = (n.midX + m.midX) / 2
        let left = model.logLikelihood(x: boundary - 0.01, y: n.midY, for: "n", on: grid)!
        let right = model.logLikelihood(x: boundary - 0.01, y: n.midY, for: "m", on: grid)!
        #expect(left > right)
        #expect(model.center(of: "m", on: grid) == (0, 0))
    }

    @Test func eachTapMovesTheCenterByItsShareOfTheEvidence() {
        var model = TouchModel()
        model.learn([TapSample(tap: tap("m", dx: -0.4), intended: "m")], on: grid)
        #expect(abs(model.center(of: "m", on: grid).x + (0.2 + 0.3 + 0.3) / 3) < 1e-12)
        model.learn(samples("m", dx: -0.4, count: 99), on: grid)
        #expect(abs(model.center(of: "m", on: grid).x + 0.4 * 100 / 101) < 0.01)
        #expect(model.taps(for: "m", on: grid) == 100)
    }

    @Test func theSameMissThreeTimesRunningMovesTheKeyAndTwoGoodTapsMoveItBack() {
        var model = TouchModel()
        let steady = { (label: String, i: Int) in TapSample(tap: tap(label, dx: Double(i % 5 - 2) * 0.06, dy: Double(i % 3 - 1) * 0.06), intended: label) }
        model.learn((0..<300).flatMap { [steady("m", $0), steady("n", $0)] }, on: grid)
        let miss = tap("m", dx: -0.7)
        let favorsM = { model.logLikelihood(x: miss.x, y: miss.y, for: "m", on: grid)! - model.logLikelihood(x: miss.x, y: miss.y, for: "n", on: grid)! }
        #expect(favorsM() < -20)
        model.learn([TapSample(tap: miss, intended: "m")], on: grid)
        #expect(favorsM() < -5)
        model.learn([TapSample(tap: miss, intended: "m"), TapSample(tap: miss, intended: "m")], on: grid)
        #expect(favorsM() > 0)
        model.learn([steady("m", 1), steady("m", 2)], on: grid)
        #expect(favorsM() < -3)
    }

    @Test func steadyTapsAnywhereTightenEveryKey() {
        var model = TouchModel()
        let w = grid.frame(of: "w")!
        let before = model.logLikelihood(x: w.midX, y: w.midY, for: "q", on: grid)!
        model.learn((0..<200).map { i in TapSample(tap: tap("e", dx: Double(i % 5 - 2) * 0.02, dy: Double(i % 3 - 1) * 0.02), intended: "e") }, on: grid)
        let after = model.logLikelihood(x: w.midX, y: w.midY, for: "q", on: grid)!
        #expect(after < before - 5)
        #expect(model.center(of: "q", on: grid) == (0, 0))
    }

    @Test func anUntouchedKeyAimsAtItsCenterAndMostlyLandsOnItself() throws {
        let q = try #require(TouchModel().aims(on: grid).first { $0.key.label == "q" })
        #expect(q.taps == 0 && q.recent.isEmpty)
        #expect(q.drift == (0, 0))
        #expect(q.onTarget > 0.9 && q.onTarget < 1)
        #expect(q.landing.first?.key.label == "q")
        #expect(abs(q.landing.map(\.share).reduce(0, +) - 1) < 1e-9)
        #expect(Set(q.landing.dropFirst().prefix(2).compactMap(\.key.label)) == ["w", "a"])
    }

    @Test func tapsThatDriftOffAKeyLandOnItsNeighbor() throws {
        var model = TouchModel()
        model.learn(samples("m", dx: -0.6, count: 200), on: grid)
        let m = try #require(model.aims(on: grid).first { $0.key.label == "m" })
        #expect(m.taps == 200)
        #expect(m.drift.x < -0.55 && abs(m.drift.y) < 0.05)
        #expect(m.landing.first?.key.label == "n")
        #expect(m.onTarget < 0.4)
    }

    @Test func eachKeyShowsOnlyItsLastTaps() throws {
        var model = TouchModel()
        model.learn(samples("m", dx: 0.1, count: 60), on: grid)
        model.learn([TapSample(tap: tap("m", dx: 0.3, dy: -0.2), intended: "m")], on: grid)
        let m = try #require(model.aims(on: grid).first { $0.key.label == "m" })
        let frame = try #require(grid.frame(of: "m"))
        #expect(m.recent.count == TouchModel.recentTaps)
        #expect(abs(m.recent.last!.x - (frame.midX + 0.3)) < 1e-3 && abs(m.recent.last!.y - (frame.midY - 0.2)) < 1e-3)
        #expect(model.signatures.map(\.signature) == ["standard"] && model.signatures.first?.taps == 61)
    }

    @Test func signaturesNameTheirLayouts() {
        let context = LayoutContext(device: .phone, layer: .letters, isLandscape: true)
        #expect(LayoutContext(signature: context.signature) == context)
        #expect(LayoutContext(signature: "standard") == nil)
    }

    @Test func layoutsLearnSeparately() {
        var model = TouchModel()
        let landscape = KeyGrid(Layouts.layout(for: LayoutContext(device: .phone, layer: .letters)), width: 20,
                                metrics: GridMetrics(columns: 10, sideInset: 0, keyGap: 0, rowGap: 0, keyHeight: 1, numberRowHeight: 1, topInset: 0),
                                signature: "landscape")
        model.learn(samples("m", dx: -0.4), on: grid)
        #expect(model.center(of: "m", on: landscape) == (0, 0))
    }

    @Test func learnedOffsetsMoveTheBoundaryButNeverPastAQuarterKey() {
        let corrector = Corrector(source: testLexicon)
        corrector.usualEnhancements = false // Exercise upstream's unrestricted hit model.
        let m = grid.frame(of: "m")!
        let between = (x: m.midX - 0.6, y: m.midY)
        #expect(corrector.keyMap(revision: 0, after: nil).key(atX: between.x, y: between.y, in: grid).map { grid.rows[$0.row][$0.key].key.label } == "n")
        corrector.learn(samples("m", dx: -0.4))
        #expect(corrector.keyMap(revision: 0, after: nil).key(atX: between.x, y: between.y, in: grid).map { grid.rows[$0.row][$0.key].key.label } == "m")
        corrector.learn(samples("m", dx: -0.8, count: 300))
        #expect(corrector.keyMap(revision: 0, after: nil).key(atX: m.midX - 1, y: m.midY, in: grid).map { grid.rows[$0.row][$0.key].key.label } == "n")
    }

    @Test func nextLetterOddsResizeKeysInsideWords() {
        let corrector = Corrector(source: testLexicon)
        corrector.usualEnhancements = false
        let o = grid.frame(of: "o")!
        let label = { (prefix: String?) in
            corrector.keyMap(revision: 0, after: prefix).key(atX: o.midX - 0.55, y: o.midY, in: grid).map { grid.rows[$0.row][$0.key].key.label }
        }
        #expect(label(nil) == "i")
        #expect(label("hell") == "o")
    }

    @Test func aTouchTakesTheKeyUnderItUntilTheMapForTheTextIsReady() throws {
        var engine = TypingEngine()
        engine.corrector = Corrector(source: testLexicon)
        engine.corrector?.usualEnhancements = false
        engine.defersSuggestions = true
        let document = TestDocument()
        engine.documentChanged(document)
        engine.type("hell", in: document)
        let o = grid.frame(of: "o")!
        let label = { (engine: TypingEngine) in engine.key(atX: o.midX - 0.55, y: o.midY, in: grid).map { grid.rows[$0.row][$0.key].key.label } }
        #expect(label(engine) == "i")
        var job = try #require(engine.suggestionJob())
        job.run()
        engine.finish(job)
        #expect(label(engine) == "o")
    }

    @Test func controlKeysKeepTheirTaps() {
        let corrector = Corrector(source: testLexicon)
        let delete = grid.rows[2].last!.frame
        let hit = corrector.keyMap(revision: 0, after: "hel").key(atX: delete.x + 0.01, y: delete.midY, in: grid)
        #expect(hit.map { grid.rows[$0.row][$0.key].key.action } == .delete)
    }
}

struct LabelTests {
    private func engine() -> TypingEngine {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        engine.corrector = Corrector(source: testLexicon)
        return engine
    }

    private func count(_ label: String, _ engine: TypingEngine) -> Int {
        engine.corrector!.memory.touches.taps(for: label, on: grid)
    }

    @Test func keptWordsTeachOnceYouMoveOn() {
        var engine = engine()
        let document = TestDocument()
        type("work ", into: &engine, document)
        #expect(count("w", engine) == 0)
        type("the ", into: &engine, document)
        #expect(count("w", engine) == 1)
        #expect(count(" ", engine) == 1)
        engine.endSession()
        #expect(count("t", engine) == 1)
    }

    @Test func revertingTeachesWhatYouTyped() throws {
        var engine = engine()
        let document = TestDocument()
        type("wotk ", into: &engine, document)
        #expect(document.text == "work ")
        engine.perform(.delete, in: document)
        engine.accept(try #require(engine.suggestions.first), in: document)
        #expect(document.text == "wotk ")
        engine.endSession()
        #expect(count("t", engine) == 1)
        #expect(count("r", engine) == 0)
    }

    @Test func acceptedCorrectionsTeachTheCorrection() {
        var engine = engine()
        let document = TestDocument()
        type("wotk ", into: &engine, document)
        engine.endSession()
        #expect(count("r", engine) == 1)
    }

    @Test func abandonedWordsTeachNothing() {
        var engine = engine()
        let document = TestDocument()
        type("work ", into: &engine, document)
        engine.deleteWord(in: document)
        type("hel", into: &engine, document)
        engine.deleteWord(in: document)
        engine.endSession()
        #expect(document.text == "")
        #expect(count("w", engine) == 0)
        #expect(count("h", engine) == 0)
    }

    @Test func retypingTeachesTheErasedTap() {
        var engine = engine()
        let document = TestDocument()
        let slip = tap("m", dx: -0.7)
        engine.perform(.character("n"), in: document, tap: slip)
        engine.perform(.delete, in: document)
        type("man ", into: &engine, document)
        engine.endSession()
        #expect(count("m", engine) == 2)
        #expect(count("n", engine) == 1)
        #expect(engine.corrector!.memory.touches.center(of: "m", on: grid).x < -0.2)
    }

    @Test func acceptingASuggestionDropsTheWordsErasedTaps() {
        var engine = engine()
        engine.settings.autoCorrection = false
        let document = TestDocument()
        type("hel", into: &engine, document)
        engine.perform(.delete, in: document)
        engine.perform(.delete, in: document)
        engine.accept(engine.suggestions[0], in: document)
        type("he ", into: &engine, document)
        engine.endSession()
        #expect(document.text == "h he ")
        #expect(count("e", engine) == 1)
    }

    @Test func retypingFarAwayIsAChangeOfMindNotASlip() {
        var engine = engine()
        let document = TestDocument()
        engine.perform(.character("q"), in: document, tap: tap("q"))
        engine.perform(.delete, in: document)
        type("man ", into: &engine, document)
        engine.endSession()
        #expect(count("m", engine) == 1)
        #expect(count("q", engine) == 0)
    }

    @Test func spaceRetypedAsBTeachesTheSpaceTapWasB() {
        var engine = engine()
        let document = TestDocument()
        type("a", into: &engine, document)
        let b = grid.frame(of: "b")!
        engine.perform(.space, in: document, tap: Tap(x: b.midX, y: b.y + b.height + 0.1, key: " "))
        engine.perform(.delete, in: document)
        type("bout ", into: &engine, document)
        engine.endSession()
        #expect(document.text == "about ")
        #expect(count("b", engine) == 2)
        #expect(count(" ", engine) == 1)
        #expect(engine.corrector!.memory.touches.center(of: "b", on: grid).y > 0.1)
    }

    @Test func resettingMemoryForgetsTouches() {
        var engine = engine()
        let document = TestDocument()
        type("work the ", into: &engine, document)
        #expect(count("w", engine) == 1)
        engine.corrector!.memory = TypingMemory()
        #expect(count("w", engine) == 0)
    }
}

struct DecoderTests {
    private func correct(_ text: String, taps: [Tap]? = nil, after previous: String? = nil, _ corrector: Corrector = Corrector(source: testLexicon)) -> String? {
        correct(text, taps: taps, after: previous, corrector: corrector)
    }

    private func correct(_ text: String, after previous: String?, _ corrector: Corrector) -> String? {
        correct(text, taps: nil, after: previous, corrector: corrector)
    }

    private func correct(_ text: String, corrector: Corrector) -> String? {
        correct(text, taps: nil, after: nil, corrector: corrector)
    }

    private func correct(_ text: String, taps: [Tap]?, after previous: String?, corrector: Corrector) -> String? {
        let taps = taps ?? text.map { tap(String($0)) }
        return corrector.correction(for: TypedWord(text, taps: taps, previous: previous))
    }

    @Test func fixesSlipsSwapsAndMissedKeys() {
        #expect(correct("wotk") == "work")
        #expect(correct("teh") == "the")
        #expect(correct("helo") == "hello")
        #expect(correct("dont") == "don't")
        #expect(correct("im") == "I'm")
        #expect(correct("i") == "I")
    }

    @Test func keepsRealWordsTypedCleanly() {
        #expect(correct("if") == nil)
        #expect(correct("men") == nil)
        #expect(correct("Hello") == nil)
    }

    @Test func aRealWordChangesOnlyWhenTheTouchesLeanAway() {
        let i = grid.frame(of: "i")!
        #expect(correct("if", taps: [Tap(x: i.midX + 0.5, y: i.midY, key: "i"), tap("f")]) == nil)
        #expect(correct("if", taps: [Tap(x: i.midX + 0.6, y: i.midY, key: "i"), tap("f")]) == "of")
    }

    @Test func frequentWordsNeverOverruleCleanTaps() {
        let corrector = Corrector(source: testLexicon)
        for _ in 0..<50 { corrector.memory.record("home", after: "go") }
        #expect(correct("come", after: "go", corrector) == nil)
        #expect(correct("hime", after: "go", corrector) == "home")
    }

    @Test func learnedTouchesTurnAHabitualSlipIntoTheWordYouMeant() {
        let corrector = Corrector(source: testLexicon)
        let slip = [tap("o", dx: -0.75), tap("f")]
        #expect(correct("if", taps: slip, corrector) == nil)
        corrector.learn(samples("o", dx: -0.75))
        #expect(correct("if", taps: slip, corrector) == "of")
    }

    @Test func missedExtraAndDoubledLettersAreSlipsLikeWrongKeys() {
        let lexicon = Lexicon(counts: [
            ("help", 9000), ("hello", 1000), ("helo", 6), ("really", 3000), ("realty", 40), ("office", 2000), ("good", 8000),
            ("better", 4000), ("writing", 1500), ("beginning", 1200), ("coming", 3000), ("dinner", 2000), ("diner", 300),
            ("it's", 9000), ("its", 5000),
        ].map { (word: $0.0, count: Double($0.1)) })
        let corrector = Corrector(source: lexicon)
        #expect(correct("helo", corrector: corrector) == "hello")
        #expect(correct("realy", corrector: corrector) == "really")
        #expect(correct("ofice", corrector: corrector) == "office")
        #expect(correct("goood", corrector: corrector) == "good")
        #expect(correct("bettter", corrector: corrector) == "better")
        #expect(correct("writting", corrector: corrector) == "writing")
        #expect(correct("begining", corrector: corrector) == "beginning")
        #expect(correct("comming", corrector: corrector) == "coming")
        #expect(correct("diner", corrector: corrector) == nil)
        #expect(correct("its", corrector: corrector) == nil)
    }

    @Test func aWordKeepsTheCaseYouTypedUnlessTheLexiconOnlyCapitalizesIt() {
        let lexicon = Lexicon(counts: [("the", 900), ("quick", 50), ("fox", 40), ("London", 60), ("I", 800)].map { (word: $0.0, count: Double($0.1)) })
        let corrector = Corrector(source: lexicon)
        #expect(correct("fox", after: "quick", corrector) == nil)
        #expect(correct("Fox", after: "quick", corrector) == nil)
        #expect(correct("london", after: "the", corrector) == "London")
        #expect(correct("i", after: "the", corrector) == "I")
    }

    @Test func aDoubledLetterTypedOnceCountsBothWays() {
        let letters = { (word: String) in Array(word.utf8).compactMap(Lexicon.index(of:)) }
        #expect(Decoder.readings(of: letters("hello"), taps: 4, completing: false).filter { $0.letters == letters("helo") }.count == 2)
    }

    @Test func deadCenterTapsMakeAFarTapCountForLess() {
        let taps = Corrector(source: testLexicon).evidence(for: TypedWord("helo", taps: "helo".map { tap(String($0)) }), touches: TouchModel())
        let alone = taps.map { $0.letters[Lexicon.index(of: UInt8(ascii: "p"))!] }.last! + taps.dropLast().map(\.best).reduce(0, +)
        #expect(Decoder.logLikelihood(of: "help", given: taps, touches: TouchModel(), on: grid) < alone)
    }

    @Test func wordsWithoutTapsUseKeyCenters() {
        #expect(correct("wotk", taps: []) == "work")
    }

    @Test func suggestsCompletionsFromTaps() {
        let corrector = Corrector(source: testLexicon)
        let typed = TypedWord("hel", taps: "hel".map { tap(String($0)) })
        let words = corrector.suggestions(for: typed, correcting: true, guessing: true).map(\.text)
        #expect(words == ["hel", "hello", "help"])
    }

    @Test func yourOwnWordsWinOnceYouUseThem() {
        let corrector = Corrector(source: testLexicon)
        #expect(correct("bassim", corrector) == nil)
        for _ in 0..<3 { corrector.memory.record("Bassim", after: "") }
        #expect(correct("bassin", corrector) == "Bassim")
    }

    @Test func nextWordCountsBackOffWithWittenBell() {
        var memory = TypingMemory()
        for _ in 0..<3 { memory.record("home", after: "go") }
        memory.record("work", after: "go")
        let model = LanguageModel(lexicon: testLexicon, memory: memory)
        #expect(abs(model.novelty - 1.0 / 6) < 1e-15, "\(model.novelty) \(memory.total)")
        let unigram = (3 + 2 * model.lexical("home")) / (4 + 2)
        let expected = (3 + 2 * unigram) / (4 + 2)
        #expect(abs(Math.exp(model.logProbability("home", after: "go")) - expected) < 1e-12)
    }
}

struct LexiconTests {
    @Test func roundTripsThroughBytes() throws {
        let copy = try #require(Lexicon(bytes: testLexicon.bytes))
        #expect(copy.wordCount == 26)
        #expect(copy.isWord("Hello"))
        #expect(!copy.isWord("hel"))
        #expect(copy.canonical("i'm") == "I'm")
        #expect(copy.canonical("THE") == "the")
        #expect(Lexicon(bytes: [1, 2, 3]) == nil)
    }

    @Test func probabilitiesAreNormalized() throws {
        let the = try #require(testLexicon.logProbability(of: "the"))
        #expect(abs(Math.exp(the) - 1000.0 / 6380) < 1000.0 / 6380 * 0.06)
    }

    @Test func listsTheMostFrequentWords() {
        #expect(testLexicon.mostFrequent(count: 1) == ["the"])
        #expect(testLexicon.completions(for: "wo") == ["work", "word", "world"])
    }
}

struct JoinTests {
    @Test func aSpaceTapThatMeantBJoinsTheWords() {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        let corrector = Corrector(source: testLexicon)
        engine.corrector = corrector
        let b = grid.frame(of: "b")!
        corrector.learn(samples("b", dx: 0, dy: 0.6))
        let document = TestDocument()
        type("a", into: &engine, document)
        engine.perform(.space, in: document, tap: Tap(x: b.midX, y: b.midY + 0.6, key: " "))
        type("out ", into: &engine, document)
        #expect(document.text == "about ")
        engine.endSession()
        #expect(corrector.memory.touches.taps(for: "b", on: grid) == 31)
        #expect(corrector.memory.count(of: "a") == 0)
    }

    @Test func aRealSpaceStaysASpace() {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        engine.corrector = Corrector(source: testLexicon)
        let document = TestDocument()
        type("a out ", into: &engine, document)
        #expect(document.text == "a out ")
    }

    @Test func secondSpacesAreAsLikelyAsYouMakeThem() {
        var memory = TypingMemory()
        let fresh = LanguageModel(lexicon: testLexicon, memory: memory).next(after: "")[" "]
        #expect(fresh == 0.5)
        for index in 0..<98 { memory.recordAfterSpace(isSpace: index == 0) }
        #expect(LanguageModel(lexicon: testLexicon, memory: memory).next(after: "")[" "] == 0.02)
    }
}

struct StraySpaceTests {
    @Test func aSecondSpaceThatMeantBStartsTheWord() throws {
        var engine = TypingEngine()
        let corrector = Corrector(source: testLexicon)
        engine.corrector = corrector
        let b = grid.frame(of: "b")!
        corrector.learn(samples("b", dx: 0, dy: 0.6))
        let document = TestDocument()
        engine.documentChanged(document)
        type("the ", into: &engine, document)
        engine.perform(.space, in: document, tap: Tap(x: b.midX, y: b.midY + 0.6, key: " "))
        #expect(document.text == "The. ")
        type("out ", into: &engine, document)
        #expect(document.text == "The about ")
        engine.perform(.delete, in: document)
        engine.accept(try #require(engine.suggestions.first), in: document)
        #expect(document.text == "The. Out ")
    }

    @Test func aDeliberatePeriodStays() {
        var engine = TypingEngine()
        engine.corrector = Corrector(source: testLexicon)
        let document = TestDocument()
        engine.documentChanged(document)
        type("the  out ", into: &engine, document)
        #expect(document.text == "The. Out ")
    }
}

struct WordStartTests {
    private func engine(learningB dy: Double) -> (TypingEngine, Corrector) {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        let corrector = Corrector(source: testLexicon)
        engine.corrector = corrector
        corrector.learn(samples("b", dx: 0, dy: dy))
        return (engine, corrector)
    }

    private func spaceBelowB(_ dy: Double) -> Tap {
        let b = grid.frame(of: "b")!
        return Tap(x: b.midX, y: b.midY + dy, key: " ")
    }

    @Test func aSpaceAtTheStartThatMeantBStartsTheWord() {
        var (engine, _) = engine(learningB: 0.6)
        let document = TestDocument()
        engine.perform(.space, in: document, tap: spaceBelowB(0.6))
        type("out ", into: &engine, document)
        #expect(document.text == "about ")
    }

    @Test func aSpaceThatMeantTheLastLetterRejoinsTheWord() throws {
        var (engine, _) = engine(learningB: 0.6)
        let document = TestDocument()
        engine.documentChanged(document)
        type("go to jo", into: &engine, document)
        engine.perform(.space, in: document, tap: spaceBelowB(0.6))
        engine.perform(.space, in: document, tap: tap(" "))
        #expect(document.text == "go to job ", "\(document.text)")
        engine.perform(.delete, in: document)
        engine.accept(try #require(engine.suggestions.first), in: document)
        #expect(document.text == "go to jo. ")
    }

    @Test func aDeliberateDoubleSpaceAfterAWordIsAPeriod() {
        var (engine, _) = engine(learningB: 0.6)
        let document = TestDocument()
        engine.documentChanged(document)
        type("go to work  ", into: &engine, document)
        #expect(document.text == "go to work. ")
    }
}
