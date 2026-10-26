import Testing
@testable import KeyboardCore

struct TypingEngineTests {
    @Test func capitalizesFirstLetterOfDocument() {
        var engine = TypingEngine()
        let document = TestDocument()
        engine.documentChanged(document)
        #expect(engine.shift == .on)
        engine.type("hello", in: document)
        #expect(document.text == "Hello")
        #expect(engine.shift == .off)
    }

    @Test func capitalizesAfterSentenceEnd() {
        var engine = TypingEngine()
        let document = TestDocument()
        engine.documentChanged(document)
        engine.type("hi. there", in: document)
        #expect(document.text == "Hi. There")
    }

    @Test func doesNotCapitalizeAfterAbbreviationWithoutSpace() {
        #expect(!TypingEngine.shouldCapitalize("e.g.", mode: .sentences))
        #expect(TypingEngine.shouldCapitalize("Done!  ", mode: .sentences))
        #expect(TypingEngine.shouldCapitalize("Line\n", mode: .sentences))
        #expect(!TypingEngine.shouldCapitalize("one two ", mode: .sentences))
    }

    @Test func autocapitalizationModes() {
        #expect(!TypingEngine.shouldCapitalize("", mode: .none))
        #expect(TypingEngine.shouldCapitalize("one ", mode: .words))
        #expect(!TypingEngine.shouldCapitalize("one", mode: .words))
        #expect(TypingEngine.shouldCapitalize("anything", mode: .allCharacters))
    }

    @Test func doubleSpaceInsertsPeriod() {
        var engine = TypingEngine()
        let document = TestDocument()
        engine.documentChanged(document)
        engine.type("ok  go", in: document)
        #expect(document.text == "Ok. Go")
    }

    @Test func doubleSpaceNeedsAWordBefore() {
        var engine = TypingEngine()
        let document = TestDocument("Ok. ")
        engine.documentChanged(document)
        engine.perform(.space, in: document)
        #expect(document.text == "Ok.  ")
    }

    @Test func doubleSpaceRequiresConsecutiveSpaces() {
        var engine = TypingEngine()
        let document = TestDocument("ok ")
        engine.documentChanged(document)
        engine.perform(.space, in: document)
        #expect(document.text == "ok  ")
    }

    @Test func doubleSpacePeriodRespectsSmartPunctuation() {
        var engine = TypingEngine(traits: InputTraits(smartPunctuation: false))
        let document = TestDocument()
        engine.type("ok  ", in: document)
        #expect(document.text == "ok  ")
    }

    @Test func shiftTogglesAndDoubleTapLocks() {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        let document = TestDocument()
        engine.pressShift(doubleTap: false)
        engine.releaseShift(in: document)
        #expect(engine.shift == .on)
        engine.pressShift(doubleTap: true)
        engine.releaseShift(in: document)
        #expect(engine.shift == .locked)
        engine.type("abc", in: document)
        #expect(document.text == "ABC")
        #expect(engine.shift == .locked)
        engine.pressShift(doubleTap: false)
        #expect(engine.shift == .off)
    }

    @Test func holdingShiftTypesCapitalsUntilReleased() {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        let document = TestDocument()
        engine.pressShift(doubleTap: false)
        engine.type("ab", in: document)
        engine.releaseShift(in: document)
        engine.type("c", in: document)
        #expect(document.text == "ABc")
    }

    @Test func spaceReturnsToLettersFromNumbers() {
        var engine = TypingEngine()
        let document = TestDocument()
        engine.perform(.layer(.numbers), in: document)
        engine.perform(.character("4"), in: document)
        #expect(engine.layer == .numbers)
        engine.perform(.space, in: document)
        #expect(engine.layer == .letters)
    }

    @Test func apostropheReturnsToLetters() {
        var engine = TypingEngine()
        let document = TestDocument("don")
        engine.perform(.layer(.numbers), in: document)
        engine.perform(.character("'"), in: document)
        #expect(engine.layer == .letters)
    }

    @Test func numberFieldsStartOnNumbers() {
        var engine = TypingEngine()
        engine.update(InputTraits(kind: .number))
        #expect(engine.layer == .numbers)
        engine.perform(.layer(.letters), in: TestDocument())
        engine.update(InputTraits(kind: .number, returnKind: .done))
        #expect(engine.layer == .letters)
    }

    @Test func deleteWordRemovesWordAndTrailingSpace() {
        var engine = TypingEngine()
        let document = TestDocument("Hello there  ")
        engine.deleteWord(in: document)
        #expect(document.text == "Hello ")
        engine.deleteWord(in: document)
        #expect(document.text == "")
        engine.deleteWord(in: document)
        #expect(document.text == "")
    }

    @Test func deleteWordTreatsPunctuationAsOneCharacter() {
        #expect(TypingEngine.wordLength(before: "Hi!!") == 1)
        #expect(TypingEngine.wordLength(before: "it's") == 4)
    }

    @Test func returnInsertsNewlineAndCapitalizes() {
        var engine = TypingEngine()
        let document = TestDocument("one")
        engine.perform(.return, in: document)
        #expect(document.text == "one\n")
        #expect(engine.shift == .on)
    }

    @Test func smartPunctuationCurlsQuotesAndJoinsDashes() {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        let document = TestDocument()
        engine.type("\"don't\" a--b", in: document)
        #expect(document.text == "“don’t” a—b")
        engine.settings.smartPunctuation = false
        engine.type(" 'x'", in: document)
        #expect(document.text == "“don’t” a—b 'x'")
    }

    @Test func keysActOnTheirOwnPhaseOfTheTouch() {
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        let document = TestDocument("ab")
        let letter = Key.character("c")
        let events: [KeyboardEvent] = [
            .down(letter, tapCount: 1), .type(letter, Tap(x: 0, y: 0, key: "c")), .down(Key(.delete), tapCount: 1),
            .trigger(Key(.return)), .trigger(Key(.dismiss)),
        ]
        let handled = events.map { engine.handle($0, in: document) }
        #expect(handled == [false, true, true, true, false])
        #expect(document.text == "ab\n")
    }

    @Test func slidingFromALayerKeyTypesOneSymbolAndComesBack() {
        var engine = TypingEngine()
        let document = TestDocument()
        engine.handle(.down(Key(.layer(.numbers)), tapCount: 1), in: document)
        engine.handle(.slide("4"), in: document)
        #expect(document.text == "4")
        #expect(engine.layer == .letters)
    }
}
