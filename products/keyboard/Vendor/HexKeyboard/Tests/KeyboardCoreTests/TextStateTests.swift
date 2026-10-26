import Testing
@testable import KeyboardCore

/// A host whose view of the text is set by the test, while the keyboard's edits land on `truth` in order.
private final class ShownHost: TextDocument {
    let truth: TestDocument
    var shown: String?

    init(_ text: String = "") {
        truth = TestDocument(text)
        shown = text
    }

    var textBeforeInput: String? { shown }
    var textAfterInput: String? { "" }
    func insert(_ text: String) { truth.insert(text) }
    func deleteBackward(_ count: Int) { truth.deleteBackward(count) }
    func moveCursor(by offset: Int) { truth.moveCursor(by: offset) }
}

struct TextStateTests {
    @Test func aLateReportChangesNothing() {
        var engine = TypingEngine.correcting()
        let host = ShownHost()
        engine.documentChanged(host)
        engine.type("so helo", in: host)
        host.shown = "So he"
        #expect(engine.documentChanged(host) == .behind)
        engine.type(" ", in: host)
        #expect(host.truth.text == "So hello ")
    }

    @Test func aWindowOfTheTextIsCurrent() {
        var engine = TypingEngine.correcting()
        let host = ShownHost()
        engine.documentChanged(host)
        engine.type("so helo", in: host)
        host.shown = "elo"
        #expect(engine.documentChanged(host) == .current)
        #expect(engine.text.before == "So helo")
    }

    @Test func aReportOfTextTheKeyboardNeverHadIsAdoptedButNeverAutocorrected() {
        var engine = TypingEngine.correcting()
        let host = ShownHost("so ")
        engine.documentChanged(host)
        engine.type("helo", in: host)
        host.shown = "so helok"
        #expect(engine.documentChanged(host) == .changed)
        engine.type(" ", in: host)
        #expect(host.truth.text == "so helo ")
    }

    @Test func anEmptyFieldAfterSendingStartsASentence() {
        var engine = TypingEngine.correcting()
        let host = ShownHost()
        engine.documentChanged(host)
        engine.type("hi there", in: host)
        host.truth.text = ""
        host.truth.cursor = 0
        host.shown = ""
        #expect(engine.documentChanged(host) == .changed)
        #expect(engine.shift == .on)
        engine.type("ok", in: host)
        #expect(host.truth.text == "Ok")
    }

    @Test func movingTheCaretMovesTheKnownText() {
        var engine = TypingEngine.correcting()
        let host = ShownHost()
        engine.documentChanged(host)
        engine.type("help world", in: host)
        engine.moveCursor(by: -6, in: host)
        #expect(engine.text.before == "Help")
        #expect(engine.text.after == " world")
        host.shown = "Help world"
        #expect(engine.documentChanged(host) == .behind)
        engine.type("s", in: host)
        #expect(host.truth.text == "Helps world")
    }
}
