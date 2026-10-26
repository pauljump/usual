import XCTest
import UIKit
import KeyboardCore

@MainActor private final class Proxy: NSObject, UITextDocumentProxy {
    var text: String
    var start: Int
    var end: Int
    let documentIdentifier = UUID()
    var documentContextBeforeInput: String? { String(text.prefix(start)) }
    var documentContextAfterInput: String? { String(text.dropFirst(end)) }
    var selectedText: String? { start == end ? nil : String(text.dropFirst(start).prefix(end - start)) }
    var documentInputMode: UITextInputMode? { nil }
    var hasText: Bool { !text.isEmpty }
    init(_ text: String, start: Int? = nil, end: Int? = nil) {
        self.text = text; self.start = start ?? text.count; self.end = end ?? start ?? text.count
    }
    func insertText(_ value: String) {
        text = String(text.prefix(start)) + value + String(text.dropFirst(end))
        start += value.count; end = start
    }
    func deleteBackward() {
        if start != end { insertText("") }
        else if start > 0 { start -= 1; insertText("") }
    }
    func adjustTextPosition(byCharacterOffset offset: Int) {
        start = min(max(0, start + offset), text.count); end = start
    }
    func setMarkedText(_ markedText: String, selectedRange: NSRange) { insertText(markedText) }
    func unmarkText() {}
}

@MainActor private final class Controller: KeyboardViewController {
    let proxy: Proxy
    init(_ proxy: Proxy) { self.proxy = proxy; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }
    override var textDocumentProxy: any UITextDocumentProxy { proxy }
    override var hasFullAccess: Bool { true }
}

@MainActor final class ActionTests: XCTestCase {
    func testSwipesAndFollowingTapKeepInputOrder() async throws {
        let (c,p) = ready("")
        c.swipeEnabled = true
        var calls = 0
        c.swipeRequest = { _,_,_,_ in
            calls += 1
            let word = calls == 1 ? "hello" : "world"
            try? await Task.sleep(for: .milliseconds(25))
            return [word]
        }
        c.beginSwipe(samples: [], keys: [])
        c.beginSwipe(samples: [], keys: [])
        c.receiveKeyboardEvent(.type(Key(.character("a")), Tap(x: 0, y: 0, key: "a")))
        try await settle { p.text == "Hello world a" }
        XCTAssertEqual(calls, 2)
    }

    func testCursorChangeCancelsPendingSwipe() async throws {
        let (c,p) = ready("hello ")
        c.swipeEnabled = true
        c.swipeRequest = { _,_,_,_ in
            try? await Task.sleep(for: .milliseconds(40))
            return ["world"]
        }
        c.beginSwipe(samples: [], keys: [])
        p.adjustTextPosition(byCharacterOffset: -2)
        c.selectionDidChange(nil)
        try await Task.sleep(for: .milliseconds(70))
        XCTAssertEqual(p.text, "hello ")
        XCTAssertFalse(c.hasPendingSwipe)
    }

    func testFinishWaitsForSwipeAndThenIncludesIt() async throws {
        let (c,p) = ready("hello ")
        c.swipeEnabled = true
        var finishCalled = false
        c.swipeRequest = { _,_,_,_ in
            try? await Task.sleep(for: .milliseconds(25))
            return ["world"]
        }
        c.finishRequest = { text,_ in
            finishCalled = true
            XCTAssertEqual(text, "hello world ")
            return .init(text: "hello world", accepted: true, ms: 0)
        }
        c.beginSwipe(samples: [], keys: [])
        try button(c,"finish").sendActions(for: .touchUpInside)
        XCTAssertFalse(finishCalled)
        try await settle { p.text == "hello world " }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await settle { finishCalled && p.text == "hello world" }
    }

    private func button(_ controller: UIViewController, _ id: String) throws -> UIButton {
        func find(_ view: UIView) -> UIButton? {
            if let b = view as? UIButton, b.accessibilityIdentifier == "usual." + id { return b }
            return view.subviews.lazy.compactMap(find).first
        }
        return try XCTUnwrap(find(controller.view))
    }
    private func ready(_ text: String, start: Int? = nil, end: Int? = nil) -> (Controller, Proxy) {
        let proxy = Proxy(text, start: start, end: end)
        let controller = Controller(proxy)
        controller.loadViewIfNeeded()
        controller.textDidChange(nil)
        return (controller, proxy)
    }
    private func settle(_ condition: @escaping @MainActor () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Controller did not settle")
    }

    func testFinishAndUndoAtMiddleCursorWithEmoji() async throws {
        let original = "hello 👋🏽 teh book"
        let (c,p) = ready(original, start: 6)
        c.finishRequest = { text,_ in
            XCTAssertEqual(text, original)
            return .init(text: "hello 👋🏽 the book", accepted: true, ms: 1)
        }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await settle { p.text == "hello 👋🏽 the book" }
        try button(c,"undo").sendActions(for: .touchUpInside)
        XCTAssertEqual(p.text, original)
    }

    func testSelectionFinishAndUndoKeepBothSurroundings() async throws {
        let (c,p) = ready("before teh book after", start: 7, end: 15)
        c.finishRequest = { text,_ in
            XCTAssertEqual(text,"teh book")
            return .init(text:"the book",accepted:true,ms:1)
        }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await settle { p.text == "before the book after" }
        try button(c,"undo").sendActions(for: .touchUpInside)
        XCTAssertEqual(p.text,"before teh book after")
    }

    func testTypingWhileFinishRunsNeverOverwritesNewText() async throws {
        let (c,p) = ready("teh book")
        var started = false
        c.finishRequest = { _,_ in
            started = true
            try await Task.sleep(for: .milliseconds(100))
            return .init(text:"the book",accepted:true,ms:100)
        }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await settle { started }
        p.insertText(" please"); c.didType(); c.textDidChange(nil)
        try await settle { (try? self.button(c,"finish").title(for: .normal)) == "Finish" }
        XCTAssertEqual(p.text,"teh book please")
    }

    func testTypingAfterFinishDisablesUndoWithoutDeletingNewText() async throws {
        let (c,p) = ready("teh book")
        c.finishRequest = { _,_ in .init(text:"the book",accepted:true,ms:1) }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await settle { p.text == "the book" }
        XCTAssertTrue(try button(c,"undo").isEnabled)
        p.insertText(" please"); c.didType(); c.textDidChange(nil)
        XCTAssertFalse(try button(c,"undo").isEnabled)
        XCTAssertEqual(p.text,"the book please")
    }

    func testRejectedFinishAndRephraseKeepOriginal() async throws {
        let (c,p) = ready("my exact words")
        c.finishRequest = { _,_ in .init(text:"invented content",accepted:false,ms:1) }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await settle { (try? self.button(c,"rephrase").title(for: .normal)) == "Info" }
        XCTAssertEqual(p.text,"my exact words")
        // A fresh controller represents the next normal action bar after dismissing that notice.
        let (r,q) = ready("my exact words")
        r.rephraseRequest = { _ in .init(text:"different meaning",same:0.1,ms:1) }
        try button(r,"rephrase").sendActions(for: .touchUpInside)
        try await settle { (try? self.button(r,"rephrase").title(for: .normal)) == "Info" }
        XCTAssertEqual(q.text,"my exact words")
    }

    func testCancelDoesNotApplyEvenIfResponseIgnoresCancellation() async throws {
        let (c,p) = ready("teh book")
        var started = false
        c.finishRequest = { _,_ in
            started = true
            try? await Task.sleep(for: .milliseconds(100))
            return .init(text:"the book",accepted:true,ms:100)
        }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await settle { started }
        try button(c,"finish").sendActions(for: .touchUpInside)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(p.text,"teh book")
    }
}
