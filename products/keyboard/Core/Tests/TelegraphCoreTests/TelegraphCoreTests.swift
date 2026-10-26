import XCTest
@testable import TelegraphCore

final class TextTests: XCTestCase {
    func testTokensAndRender() {
        XCTAssertEqual(Words.words("Sounds good, see you at 7!"), ["sounds", "good", "see", "you", "at", "7"])
        XCTAssertEqual(Words.words("I’m here"), ["i'm", "here"])
        XCTAssertEqual(Words.render(["sounds", "good", ",", "i'm", "in", ".", "see", "you"]),
                       "Sounds good, I'm in. See you")
    }

    func testProseFilter() {
        XCTAssertTrue(Words.isProse("ok push it"))
        XCTAssertFalse(Words.isProse("```swift\nlet x = 1\n```"))
        XCTAssertFalse(Words.isProse("cd /Users/me && make"))
    }
}

final class LexiconTests: XCTestCase {
    func lexicon() -> Lexicon {
        var lex = Lexicon()
        for _ in 0..<5 { lex.learn("sounds good see you soon") }
        for _ in 0..<3 { lex.learn("see you at the game") }
        lex.learn("ask Jev about it")
        lex.addBackground("so some such sound start good great go")
        return lex
    }

    func testCandidatesUsePairs() {
        let p = Predictor(lexicon())
        XCTAssertEqual(p.candidates("g", after: "sounds", limit: 3).first?.word, "good")
        XCTAssertEqual(p.candidates("s", after: "you", limit: 3).first?.word, "soon")
        XCTAssertEqual(p.candidates("s", after: Lexicon.start, limit: 3).first?.word, "sounds")
    }

    func testCasingAndRoundTrip() throws {
        let lex = lexicon()
        XCTAssertEqual(lex.display("jev"), "Jev")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("t.telegraph")
        try lex.save(to: url)
        XCTAssertEqual(Lexicon.load(from: url)?.personal["sounds"], 5)
    }
}

final class DecoderTests: XCTestCase {
    let predictor: Predictor = {
        var lex = Lexicon()
        for _ in 0..<5 { lex.learn("sounds good see you soon") }
        for _ in 0..<3 { lex.learn("see you at 7") }
        return Predictor(lex)
    }()

    func testDecodesInitials() {
        let slots: [Slot] = "sgsys".map { .initial(String($0)) }
        let r = WordDecoder().decode(slots, with: predictor)
        XCTAssertEqual(r.map(\.word), ["sounds", "good", "see", "you", "soon"])
    }

    func testNumbersAndPunctuationPassThrough() {
        let slots: [Slot] = [.initial("s"), .initial("y"), .initial("a"), .word("7"), .punct("!")]
        let r = WordDecoder().decode(slots, with: predictor)
        XCTAssertEqual(Words.render(r.map(\.word)), "See you at 7!")
    }

    func testCompositionLocksChosenWord() {
        var c = Composition()
        let d = WordDecoder()
        for ch in "sgs" { c.append(.initial(String(ch)), decoder: d, predictor: predictor) }
        c.choose("great", at: 1, decoder: d, predictor: predictor)
        c.append(.initial("y"), decoder: d, predictor: predictor)
        XCTAssertEqual(c.readings[1].word, "great")
        XCTAssertTrue(c.readings[1].locked)
        c.deleteLast(decoder: d, predictor: predictor)
        XCTAssertEqual(c.slots.count, 3)
    }

    func testJevRequestHasOneQuestionPerOpenWord() throws {
        let slots: [Slot] = [.initial("s"), .initial("g"), .word("7")]
        let d = WordDecoder()
        let r = d.decode(slots, with: predictor)
        let req = try XCTUnwrap(d.jevRequest(slots, readings: r, before: "", recent: ["hi"]))
        XCTAssertEqual(Set(req.questions.keys), ["w0", "w1"])
        let body = String(decoding: try JSONEncoder().encode(JevRequest(state: req.state, model: "jev-latest",
                                                                       questions: req.questions)), as: UTF8.self)
        XCTAssertTrue(body.contains("s… g… 7"))
        // First option is the local best guess (Jev leans toward the first option).
        let w0 = try XCTUnwrap(req.questions["w0"]?.criteria)
        guard case let .object(pairs) = w0 else { return XCTFail() }
        XCTAssertEqual(pairs.first?.0, r[0].word)
    }

    func testApplyJevAndGate() throws {
        let slots: [Slot] = [.initial("s"), .initial("g")]
        let r = WordDecoder().decode(slots, with: predictor)
        let json = #"{"model":"jev-1.13.0","answers":{"w1":{"type":"choice","choice":"great","probabilities":{"good":0.1,"great":0.85},"confidence":0.8}},"usage":{"input_tokens":300}}"#
        var readings = r
        readings[1].options = ["good", "great"]
        let resp = try JSONDecoder().decode(JevResponse.self, from: Data(json.utf8))
        let out = WordDecoder.apply(JevClient.Timed(response: resp, milliseconds: 90), to: readings)
        XCTAssertEqual(out[1].word, "great")
        XCTAssertFalse(out[1].unsure)
        XCTAssertEqual(out[0].source, .local)
    }
}

final class ImporterTests: XCTestCase {
    func testClaudeAndCodex() {
        let claude = """
        {"type":"user","message":{"role":"user","content":"yes push it"},"timestamp":"2026-10-01T12:00:00.000Z"}
        {"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"}]}}
        {"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name>"}}
        {"type":"assistant","message":{"content":"hi"}}
        """
        let m = Importers.claudeJSONL(claude)
        XCTAssertEqual(m.map(\.text), ["yes push it"])
        XCTAssertNotNil(m.first?.date)

        let codex = """
        {"timestamp":"2026-10-01T12:00:00Z","type":"event_msg","payload":{"type":"user_message","message":"run the tests"}}
        {"timestamp":"2026-10-01T12:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"run the tests"}]}}
        {"timestamp":"2026-10-01T12:00:02Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>x</environment_context>"}]}}
        """
        XCTAssertEqual(Importers.codexJSONL(codex).map(\.text), ["run the tests"])
    }

    func testMboxKeepsOnlyNewText() {
        let mbox = """
        From 1@xxx Mon Oct 06 12:00:00 +0000 2026
        From: Paul <paul@example.com>
        Date: Mon, 6 Oct 2026 08:00:00 -0400
        Content-Type: text/plain; charset=UTF-8
        Content-Transfer-Encoding: quoted-printable

        Works for me, see you Thursday=21

        On Sun, Oct 5, 2026 at 9:00 PM Someone <s@example.com> wrote:
        > Thursday?

        From 2@xxx Mon Oct 06 13:00:00 +0000 2026
        From: Someone <s@example.com>
        Content-Type: text/plain

        not mine
        """
        let m = Importers.mbox(mbox, me: "paul@example.com")
        XCTAssertEqual(m.map(\.text), ["Works for me, see you Thursday!"])
        XCTAssertNotNil(m.first?.date)
    }
}
