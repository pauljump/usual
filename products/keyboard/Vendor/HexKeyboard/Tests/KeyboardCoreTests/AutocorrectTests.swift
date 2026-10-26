import Testing
@testable import KeyboardCore

struct AutocorrectTests {
    @Test func findsMisspelledWords() {
        let corrector = Corrector(source: testLexicon)
        corrector.memory.keep("qzxv")
        let text = "I’m done, helo world's qzxv 42nd 'wrld' hello"
        #expect(corrector.misspellings(in: text).map { String(text[$0]) } == ["helo", "wrld"])
    }

    @Test func correctsOnSpaceKeepingCase() {
        var engine = TypingEngine.correcting()
        let document = TestDocument()
        engine.documentChanged(document)
        engine.type("helo wrld ", in: document)
        #expect(document.text == "Hello world ")
    }

    @Test func correctsBeforePunctuation() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("ok ")
        engine.documentChanged(document)
        engine.type("wrld.", in: document)
        #expect(document.text == "ok world.")
    }

    @Test func showsLiteralThenPendingCorrection() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("so ")
        engine.documentChanged(document)
        engine.type("helo", in: document)
        #expect(engine.suggestions.map(\.text) == ["helo", "hello", "help"])
        #expect(engine.suggestions.map(\.kind) == [.literal, .correction, .candidate])
    }

    @Test func suggestionJobMatchesRankingInline() {
        var inline = TypingEngine()
        inline.corrector = Corrector(source: testLexicon)
        var deferred = TypingEngine()
        deferred.corrector = Corrector(source: testLexicon)
        deferred.defersSuggestions = true
        let (a, b) = (TestDocument("so "), TestDocument("so "))
        inline.documentChanged(a)
        deferred.documentChanged(b)
        inline.type("helo", in: a)
        deferred.type("helo", in: b)
        #expect(deferred.suggestionsAreStale)
        var job = try! #require(deferred.suggestionJob())
        job.run()
        deferred.finish(job)
        #expect(!deferred.suggestionsAreStale)
        #expect(deferred.suggestions == inline.suggestions)
        inline.type(" ", in: a)
        deferred.type(" ", in: b)
        #expect(b.text == a.text)
    }

    @Test func suggestionJobForOlderTextIsDropped() {
        var engine = TypingEngine()
        engine.corrector = Corrector(source: testLexicon)
        engine.defersSuggestions = true
        let document = TestDocument()
        engine.documentChanged(document)
        engine.type("hel", in: document)
        var job = try! #require(engine.suggestionJob())
        engine.type("o", in: document)
        job.run()
        engine.finish(job)
        #expect(engine.suggestionsAreStale)
        #expect(engine.suggestions.isEmpty)
    }

    @Test func completesPartialWords() {
        var engine = TypingEngine.correcting()
        let document = TestDocument()
        engine.documentChanged(document)
        engine.type("hel", in: document)
        #expect(engine.suggestions.map(\.text) == ["Hel", "Help", "Hello"])
    }

    @Test func deleteAfterCorrectionOffersRevert() throws {
        var engine = TypingEngine.correcting()
        let document = TestDocument("so ")
        engine.documentChanged(document)
        engine.type("helo ", in: document)
        engine.perform(.delete, in: document)
        #expect(document.text == "so hello")
        let revert = try #require(engine.suggestions.first)
        #expect(revert == Suggestion("helo", .revert))
        engine.accept(revert, in: document)
        #expect(document.text == "so helo ")
        engine.type("helo ", in: document)
        #expect(document.text == "so helo helo ")
    }

    @Test func secondDeleteDropsTheRevert() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("so ")
        engine.documentChanged(document)
        engine.type("helo ", in: document)
        engine.perform(.delete, in: document)
        engine.perform(.delete, in: document)
        #expect(document.text == "so hell")
        #expect(!engine.suggestions.contains { $0.kind == .revert })
    }

    @Test func tappingTheLiteralKeepsIt() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("so ")
        engine.documentChanged(document)
        engine.type("helo", in: document)
        engine.accept(engine.suggestions[0], in: document)
        engine.type("helo ", in: document)
        #expect(document.text == "so helo helo ")
    }

    @Test func tappingACandidateReplacesTheWord() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("so ")
        engine.documentChanged(document)
        engine.type("hel", in: document)
        engine.accept(engine.suggestions[2], in: document)
        #expect(document.text == "so hello ")
    }

    @Test func expandsTextReplacements() {
        var engine = TypingEngine.correcting()
        engine.corrector?.setReplacements([("omw", "On my way!")])
        let document = TestDocument()
        engine.documentChanged(document)
        engine.type("omw", in: document)
        #expect(engine.suggestions[1] == Suggestion("On my way!", .correction))
        engine.perform(.space, in: document)
        #expect(document.text == "On my way! ")
        engine.perform(.delete, in: document)
        engine.accept(engine.suggestions[0], in: document)
        #expect(document.text == "Omw ")
    }

    @Test func capitalizesNames() {
        var engine = TypingEngine.correcting()
        engine.corrector?.setNames(["Bassim"])
        let document = TestDocument("hi ")
        engine.documentChanged(document)
        engine.type("bas", in: document)
        #expect(engine.suggestions[1].text == "Bassim")
        engine.type("sim ", in: document)
        #expect(document.text == "hi Bassim ")
    }

    @Test func namesThatAreEverydayWordsStayLowercase() {
        var engine = TypingEngine()
        engine.corrector = Corrector(source: testLexicon)
        engine.corrector?.setNames(["A", "The", "Man", "Bassim"])
        let document = TestDocument("so ")
        engine.documentChanged(document)
        engine.type("the man is a bassim ", in: document)
        #expect(document.text == "so the man is a Bassim ")
    }

    @Test func respectsFieldsAndSettings() {
        for traits in [InputTraits(kind: .url), InputTraits(kind: .email), InputTraits(autocorrection: false)] {
            var engine = TypingEngine.correcting()
            engine.update(traits)
            let document = TestDocument("x ")
            engine.type("helo ", in: document)
            #expect(document.text == "x helo ")
        }
        var engine = TypingEngine.correcting()
        engine.settings.autoCorrection = false
        let document = TestDocument("x ")
        engine.type("helo ", in: document)
        #expect(document.text == "x helo ")
    }

    @Test func hidesSuggestionsWhenPredictiveTextIsOffButStillCorrects() {
        var engine = TypingEngine.correcting()
        engine.settings.predictiveText = false
        let document = TestDocument("x ")
        engine.type("helo", in: document)
        #expect(engine.suggestions.isEmpty)
        engine.perform(.space, in: document)
        #expect(document.text == "x hello ")
    }

    @Test func leavesHandlesUrlsAndNumbersAlone() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("mail @")
        engine.type("helo ", in: document)
        engine.type("wrld2 ", in: document)
        #expect(document.text == "mail @helo wrld2 ")
    }

    @Test func doesNotCorrectInsideAWord() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("heloworld")
        document.cursor = 4
        engine.perform(.space, in: document)
        #expect(document.text == "helo world")
    }

    @Test func learnsNextWordsFromWhatYouType() {
        var engine = TypingEngine.correcting()
        let document = TestDocument("x ")
        engine.type("see you. see you. see ", in: document)
        #expect(engine.suggestions.first == Suggestion("you", .candidate))
    }

    @Test func findsTheCurrentWord() {
        #expect(Words.current(in: "it's") == "it's")
        #expect(Words.current(in: "say 'hi") == "hi")
        #expect(Words.current(in: "end. ") == "")
        #expect(Words.isCorrectable(Words.current(in: "(helo"), in: "(helo"))
        #expect(!Words.isCorrectable(Words.current(in: "a.helo"), in: "a.helo"))
    }
}
