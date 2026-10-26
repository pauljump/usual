import Foundation
import Testing
@testable import KeyboardCore

/// Fast, random typing against a host that behaves like an iOS text field seen from a keyboard extension: the proxy's
/// view of the text is cut to a window, keyboard edits show up in it at once, and the host's own reports
/// (`textDidChange`) arrive late, showing the text as it was a few edits ago, sometimes still holding a character a
/// delete already removed. Ranking jobs finish at random times, suggestions get tapped, words get deleted, and the app
/// changes the text on its own (clearing a sent message, pasting).
///
/// Three keyboards take exactly the same events: one on a perfect host that never reports, one on a perfect host that
/// reports at the same moments as the iOS-like one, and one on the iOS-like host. All three must end with the same text
/// after every event: what the host shows, and when, must never change what the taps produce.
struct TextStateStressTests {
    static let words = ["the", "a", "to", "i", "of", "in", "is", "on", "if", "no", "go", "i'm", "don't", "done", "work",
                        "word", "world", "hello", "help", "about", "out", "man", "men", "come", "home", "job", "teh", "wrld"]

    @Test func lateTruncatedReportsNeverChangeWhatTapsType() {
        let runs = 3000
        var failures: [String] = []
        var stats = Stats()
        let only = ProcessInfo.processInfo.environment["SEED"].flatMap { UInt64($0) }
        for seed in 0..<UInt64(runs) where only == nil || only == seed {
            if let failure = Self.run(seed: seed, stats: &stats) { failures.append(failure) }
        }
        print("STRESS runs=\(runs) events=\(stats.events) keys=\(stats.keys) reports=\(stats.reports) behind=\(stats.behind) "
              + "phantom=\(stats.phantoms) jobs=\(stats.jobs) taps=\(stats.suggestionTaps) external=\(stats.external) "
              + "failed=\(failures.count)")
        for (index, name) in ["perfect host reporting", "iOS-like host"].enumerated() {
            print("STRESS \(name), final text vs ideal: \(stats.lostLetters[index]) letters lost in \(stats.runsLosingLetters[index]) runs, "
                  + "\(stats.caseOnly[index]) runs differ only in case, \(stats.otherwise[index]) differ otherwise")
        }
        for failure in failures.prefix(5) { print("STRESS \(failure)") }
        for example in stats.examples { print("STRESS lost: \(example)") }
        #expect(failures.isEmpty)
    }

    struct Stats {
        var events = 0, keys = 0, reports = 0, behind = 0, phantoms = 0, jobs = 0, suggestionTaps = 0, external = 0
        var examples: [String] = []
        var lostLetters = [0, 0], runsLosingLetters = [0, 0], caseOnly = [0, 0], otherwise = [0, 0]
    }

    struct Keyboard {
        var engine: TypingEngine
        var job: SuggestionJob?

        init() {
            engine = TypingEngine()
            engine.corrector = Corrector(source: testLexicon)
            engine.defersSuggestions = true
        }
    }

    static func run(seed: UInt64, stats: inout Stats) -> String? {
        var random = Random(seed: seed &* 0x9E37_79B9_7F4A_7C15 &+ 1)
        let passage = (0..<random.int(4...12)).map { _ in words[random.int(0...(words.count - 1))] }.joined(separator: " ") + " "
        let grid = KeyGrid.standard
        let ideal = TestDocument(), confirmed = TestDocument(), host = LateHost()
        var keyboards = [Keyboard(), Keyboard(), Keyboard()]
        let documents: [any TextDocument] = [ideal, confirmed, host]
        var log: [String] = []
        var position = passage.startIndex
        var divergence: String?

        func each(_ body: (inout Keyboard, any TextDocument) -> Void) {
            for index in keyboards.indices { body(&keyboards[index], documents[index]) }
        }

        func report(index: Int) {
            switch index {
            case 1: keyboards[1].engine.documentChanged(confirmed)
            case 2: keyboards[2].engine.documentChanged(host)
            default: break
            }
        }

        func changedExternally() {
            stats.external += 1
            host.reportNow()
            each { keyboard, document in keyboard.engine.documentChanged(document) }
        }

        each { keyboard, document in keyboard.engine.documentChanged(document) }
        while position < passage.endIndex, log.count < 400 {
            stats.events += 1
            let roll = random.unit()
            if roll < 0.04 {
                log.append("⌫")
                each { keyboard, document in keyboard.engine.perform(.delete, in: document) }
                if position > passage.startIndex { position = passage.index(before: position) }
            } else if roll < 0.045 {
                log.append("⌫word")
                each { keyboard, document in keyboard.engine.deleteWord(in: document) }
                position = passage[..<position].dropLast().lastIndex(of: " ").map(passage.index(after:)) ?? passage.startIndex
            } else if roll < 0.08 {
                let choice = random.int(0...2)
                log.append("pick\(choice)")
                stats.suggestionTaps += 1
                each { keyboard, document in
                    if choice < keyboard.engine.suggestions.count { keyboard.engine.accept(keyboard.engine.suggestions[choice], in: document) }
                }
                position = passage[position...].firstIndex(of: " ").map(passage.index(after:)) ?? passage.endIndex
            } else if roll < 0.083 {
                let change = random.int(0...2)
                log.append("external\(change)")
                for document in [ideal, confirmed] as [TestDocument] {
                    switch change {
                    case 0: document.text = ""; document.cursor = 0
                    case 1: document.insert("ok ")
                    default: document.cursor = document.text.count
                    }
                }
                switch change {
                case 0: host.clear()
                case 1: host.paste("ok ")
                default: host.moveToEnd()
                }
                changedExternally()
            } else {
                let character = passage[position]
                position = passage.index(after: position)
                stats.keys += 1
                let target = grid.frame(of: String(character == "'" ? " " : character))!
                let noise = character == " " ? 0.15 : 0.3
                let x = target.midX + random.gaussian() * noise * min(target.width, 1), y = target.midY + random.gaussian() * noise
                log.append(String(character))
                each { keyboard, document in
                    if character == "'" {
                        keyboard.engine.perform(.character("'"), in: document)
                        return
                    }
                    let hit = keyboard.engine.key(atX: x, y: y, in: grid)!
                    let label = grid.rows[hit.row][hit.key].key.label ?? String(character)
                    keyboard.engine.perform(label == " " ? .space : .character(label), in: document, tap: Tap(x: x, y: y, key: label))
                }
            }

            if random.unit() < 0.5 {
                for index in keyboards.indices where keyboards[index].job == nil {
                    keyboards[index].job = keyboards[index].engine.suggestionJob()
                }
                stats.jobs += 1
            }
            if random.unit() < 0.4 {
                for index in keyboards.indices {
                    guard var job = keyboards[index].job else { continue }
                    job.run()
                    keyboards[index].engine.finish(job)
                    keyboards[index].job = nil
                }
            }
            if random.unit() < 0.35 {
                let lag = random.int(0...4), window = random.int(1...40), phantom = random.unit() < 0.2
                stats.reports += 1
                if lag > 0 { stats.behind += 1 }
                if host.report(lag: lag, window: window, phantom: phantom) { stats.phantoms += 1 }
                report(index: 1)
                report(index: 2)
            }

            if divergence == nil, confirmed.text != ideal.text || host.text != ideal.text {
                divergence = "seed \(seed): \(log.joined(separator: " ")) → ideal \"\(ideal.text)\" confirmed \"\(confirmed.text)\" iOS \"\(host.text)\""
            }
        }
        for (index, text) in [confirmed.text, host.text].enumerated() where text != ideal.text {
            let letters = ideal.text.filter(\.isLetter).count - text.filter(\.isLetter).count
            if letters > 0 {
                stats.runsLosingLetters[index] += 1
                stats.lostLetters[index] += letters
                if stats.examples.count < 12 { stats.examples.append("[\(index)] \(log.joined(separator: " ")) → ideal \"\(ideal.text)\" got \"\(text)\"") }
            } else if text.lowercased() == ideal.text.lowercased() {
                stats.caseOnly[index] += 1
            } else {
                stats.otherwise[index] += 1
            }
        }
        return divergence
    }
}

/// A text field as a keyboard extension sees it. `text` is the truth, with every edit applied in order. The proxy's
/// view (`textBeforeInput`) takes the keyboard's edits at once, but a report from the host replaces it with the text
/// as it was `lag` edits ago, cut to the last `window` characters, and the keyboard's next edits land on that stale
/// view until the next report.
final class LateHost: TextDocument {
    private(set) var text = ""
    private var cursor = 0
    private var history: [(text: String, cursor: Int)] = [("", 0)]
    private var view = (before: "", after: "")
    private var reported = 0

    var textBeforeInput: String? { view.before }
    var textAfterInput: String? { view.after }

    func insert(_ value: String) {
        text.insert(contentsOf: value, at: text.index(text.startIndex, offsetBy: cursor))
        cursor += value.count
        record()
        view.before += value
    }

    func deleteBackward(_ count: Int) {
        let removed = min(count, cursor)
        let end = text.index(text.startIndex, offsetBy: cursor)
        text.removeSubrange(text.index(end, offsetBy: -removed)..<end)
        cursor -= removed
        record()
        view.before.removeLast(min(count, view.before.count))
    }

    func moveCursor(by offset: Int) {
        cursor = min(max(cursor + offset, 0), text.count)
        record()
        reportNow()
    }

    func clear() {
        text = ""
        cursor = 0
        record()
    }

    func paste(_ value: String) {
        text.insert(contentsOf: value, at: text.index(text.startIndex, offsetBy: cursor))
        cursor += value.count
        record()
    }

    func moveToEnd() {
        cursor = text.count
        record()
    }

    func reportNow() {
        _ = report(lag: 0, window: 1000, phantom: false)
    }

    /// Shows the text as it was `lag` edits ago, never older than what the last report showed: the host only ever moves
    /// forward through the keyboard's edits. A late report never shows an empty field once the field has text: an
    /// empty context is how the keyboard learns a message was sent, so it is taken at its word. A phantom report shows the text from just before the last delete, as if
    /// the delete hadn't reached the host yet.
    func report(lag: Int, window: Int, phantom: Bool) -> Bool {
        let last = history.count - 1
        var index = max(last - lag, reported)
        let isPhantom = phantom && last > reported && history[last].text.count < history[last - 1].text.count
        if isPhantom { index = last - 1 }
        while index < last, Self.before(history[index]).isEmpty, !Self.before(history[last]).isEmpty { index += 1 }
        reported = index
        let (text, cursor) = history[index]
        let split = text.index(text.startIndex, offsetBy: cursor)
        view = (String(text[..<split].suffix(window)), String(text[split...].prefix(window)))
        return isPhantom
    }

    private static func before(_ state: (text: String, cursor: Int)) -> Substring {
        state.text.prefix(state.cursor)
    }

    private func record() {
        history.append((text, cursor))
    }
}

struct Random {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }

    mutating func int(_ range: ClosedRange<Int>) -> Int { range.lowerBound + Int(next() % UInt64(range.count)) }

    mutating func gaussian() -> Double {
        sqrt(-2 * log(max(unit(), .leastNormalMagnitude))) * cos(2 * .pi * unit())
    }
}
