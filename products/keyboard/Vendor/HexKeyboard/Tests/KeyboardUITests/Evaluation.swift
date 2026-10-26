import Foundation
import Testing
import KeyboardCore
@testable import KeyboardUI

/// Types the MacKenzie & Soukoreff phrase set through `TypingEngine` with simulated taps and reports word accuracy.
///
/// Three keyboards: (a) nearest-key hit-testing + `UITextChecker` (the old default), (b) Hex's decoder with the touch
/// model held at its prior, (c) the same decoder learning from every word it commits.
@MainActor
struct Evaluation {
    static let width = 402.0
    static let noiseLevels = [0.0, 0.15, 0.25, 0.35]

    enum Keyboard: String, CaseIterable {
        case baseline, decoder, learning
    }

    static func phrases() throws -> [String] {
        let url = try #require(Bundle.module.url(forResource: "phrases", withExtension: "txt"))
        return try String(contentsOf: url, encoding: .utf8).split(separator: "\n").map { $0.lowercased() }
    }

    @Test func noise() throws {
        let phrases = try Self.phrases()
        for keyboard in Keyboard.allCases {
            for noise in Self.noiseLevels {
                var user = SimulatedUser(width: Self.width, noise: noise, seed: 2026)
                var session = Session(keyboard, grid: user.grid)
                for phrase in phrases {
                    session.startPhrase()
                    for word in phrase.split(separator: " ") { session.type(String(word), by: &user, tappingSpace: false) }
                }
                print("EVAL noise=\(noise) keyboard=\(keyboard.rawValue) \(session.score)")
            }
        }
    }

    /// Main-thread cost per keystroke of what the extension runs for one key: hit-testing on touch down, the key on
    /// touch up, and the document refresh the host's `textDidChange` triggers.
    @Test func latency() throws {
        let phrases = try Self.phrases().prefix(100)
        var user = SimulatedUser(width: Self.width, noise: 0.2, seed: 2026)
        var session = Session(.learning, grid: user.grid)
        var down: [Duration] = [], letters: [Duration] = [], spaces: [Duration] = [], changed: [Duration] = []
        let clock = ContinuousClock()
        for phrase in phrases {
            session.startPhrase()
            for character in phrase + " " {
                let (x, y) = user.tap(character)
                var hit: (row: Int, key: Int)?
                down.append(clock.measure { hit = session.engine.key(atX: x, y: y, in: session.grid) })
                guard let hit, let label = session.grid.rows[hit.row][hit.key].key.label else { continue }
                let up = clock.measure {
                    session.engine.perform(label == " " ? .space : .character(label), in: session.document, tap: Tap(x: x, y: y, key: label))
                }
                if label == " " { spaces.append(up) } else { letters.append(up) }
                changed.append(clock.measure { session.engine.documentChanged(session.document) })
            }
        }
        func summary(_ name: String, _ samples: [Duration]) -> String {
            let ms = samples.map { Double($0.components.attoseconds) / 1e15 + Double($0.components.seconds) * 1000 }.sorted()
            let at = { (q: Double) in String(format: "%.2f", ms[min(ms.count - 1, Int(Double(ms.count) * q))]) }
            return "\(name) median=\(at(0.5)) p95=\(at(0.95)) p99=\(at(0.99)) max=\(at(1))"
        }
        print("EVAL latency ms keys=\(down.count) \(summary("down", down)) | \(summary("letter up", letters)) | \(summary("space up", spaces)) | \(summary("textDidChange", changed))")
    }

    /// The suggestion bar before each word: how often the word you type next is one of the three it shows, and how
    /// often it's the first. Each corpus is typed once by a new user (memory cleared every phrase) and once by a user
    /// whose memory keeps every phrase before it. `chat.txt` is one sentence from each of 1,000 user turns in Google's
    /// Taskmaster-1 self-dialogs (CC BY 4.0, github.com/google-research-datasets/Taskmaster).
    @Test func predictions() throws {
        for corpus in ["phrases", "chat"] {
            let url = try #require(Bundle.module.url(forResource: corpus, withExtension: "txt"))
            let phrases = try String(contentsOf: url, encoding: .utf8).split(separator: "\n")
            for learning in [false, true] {
                var prediction = Prediction()
                for phrase in phrases {
                    if !learning { prediction.engine.corrector?.memory = TypingMemory() }
                    prediction.type(phrase.split(separator: " ").map(String.init))
                }
                print("EVAL predict corpus=\(corpus) user=\(learning ? "learning" : "new") \(prediction.summary)")
            }
        }
    }

    @Test func biasedThumbs() throws {
        let phrases = try Self.phrases()
        let block = 500
        for keyboard in Keyboard.allCases {
            var user = SimulatedUser(width: Self.width, noise: 0.2, seed: 7, bias: SimulatedUser.thumbs)
            var session = Session(keyboard, grid: user.grid)
            var curve: [String] = []
            for _ in 0..<2 {
                for phrase in phrases {
                    session.startPhrase()
                    for word in phrase.split(separator: " ") {
                        session.type(String(word), by: &user, tappingSpace: true)
                        if session.score.words % block == 0 { curve.append(session.window.summary); session.window = Score() }
                    }
                }
            }
            print("EVAL thumbs keyboard=\(keyboard.rawValue) total: \(session.score)")
            print("EVAL thumbs keyboard=\(keyboard.rawValue) per \(block) words (raw/final): \(curve.joined(separator: " "))")
            if keyboard == .learning, let corrector = session.engine.corrector {
                let centers = ["m", "b", "o", "e"].map { label in
                    let c = corrector.memory.touches.center(of: label, on: user.grid)
                    return "\(label)=(\(String(format: "%+.2f", c.x)),\(String(format: "%+.2f", c.y)))"
                }
                print("EVAL thumbs learned centers: \(centers.joined(separator: " "))")
            }
        }
    }

    /// A user who has typed the corpus with `thumbs`, then changes how they hold the phone: every tap lands lower and
    /// to the right, o and e swing to the other side, b and m drop further. Prints the corpus typed after the change,
    /// with the first 500 words per 100.
    @Test func aimShift() throws {
        let phrases = try Self.phrases()
        var user = SimulatedUser(width: Self.width, noise: 0.2, seed: 11, bias: SimulatedUser.thumbs)
        var session = Session(.learning, grid: user.grid)
        for phrase in phrases {
            session.startPhrase()
            for word in phrase.split(separator: " ") { session.type(String(word), by: &user, tappingSpace: true) }
        }
        user = SimulatedUser(width: Self.width, noise: 0.2, seed: 12, bias: SimulatedUser.shifted)
        session.score = Score()
        session.window = Score()
        var curve: [String] = []
        for phrase in phrases {
            session.startPhrase()
            for word in phrase.split(separator: " ") {
                session.type(String(word), by: &user, tappingSpace: true)
                let words = session.score.words
                if words <= 500 ? words % 100 == 0 : words % 500 == 0 { curve.append(session.window.summary); session.window = Score() }
            }
        }
        print("EVAL aimShift keyboard=learning after: \(session.score)")
        print("EVAL aimShift keyboard=learning per 100 words to 500, then per 500 (raw/final): \(curve.joined(separator: " "))")
    }
}

@MainActor
struct Session {
    let keyboard: Evaluation.Keyboard
    let grid: KeyGrid
    var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
    var document = Document()
    var score = Score()
    var window = Score()

    init(_ keyboard: Evaluation.Keyboard, grid: KeyGrid) {
        self.keyboard = keyboard
        self.grid = grid
        let source: any CandidateSource = keyboard == .baseline ? TextCheckerSource(language: "en-US") : Lexicon.english
        let corrector = Corrector(source: source, phrases: keyboard == .baseline ? nil : .english)
        corrector.grid = grid
        engine.corrector = corrector
    }

    mutating func startPhrase() {
        engine.endSession()
        let corrector = engine.corrector
        engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        engine.corrector = corrector
        document = Document()
        engine.suggestionsChanged()
    }

    mutating func type(_ word: String, by user: inout SimulatedUser, tappingSpace: Bool) {
        let start = document.text.count
        let predictions = engine.suggestions.map { $0.text.lowercased() }
        var typed = ""
        for character in word + (tappingSpace ? " " : "") {
            let (x, y) = user.tap(character)
            let hit = keyboard == .baseline ? grid.index(atX: x, y: y) : engine.key(atX: x, y: y, in: grid)
            guard let hit, let label = grid.rows[hit.row][hit.key].key.label, tappingSpace || label != " " else { continue }
            if character != " " { typed += label }
            if character == " " { shown = engine.suggestions.map { $0.text.lowercased() } }
            engine.perform(label == " " ? .space : .character(label), in: document, tap: Tap(x: x, y: y, key: label))
        }
        if !tappingSpace {
            shown = engine.suggestions.map { $0.text.lowercased() }
            engine.perform(.space, in: document)
        }
        if keyboard == .decoder {
            engine.endSession()
            engine.corrector?.memory.touches = TouchModel()
        }
        let final = String(document.text.dropFirst(start)).trimmingCharacters(in: .whitespaces).lowercased()
        score.add(word: word, typed: typed, final: final, shown: shown, predictions: predictions)
        window.add(word: word, typed: typed, final: final, shown: shown, predictions: predictions)
    }

    private var shown: [String] = []
}

@MainActor
struct Prediction {
    var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
    var words = 0, first = 0, topThree = 0

    init() {
        engine.corrector = Corrector(source: Lexicon.english, phrases: .english)
    }

    mutating func type(_ phrase: [String]) {
        engine.endSession()
        let corrector = engine.corrector
        engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        engine.corrector = corrector
        let document = Document()
        engine.suggestionsChanged()
        for word in phrase {
            let shown = engine.suggestions.map { $0.text.lowercased() }
            words += 1
            if shown.first == word.lowercased() { first += 1 }
            if shown.contains(word.lowercased()) { topThree += 1 }
            for character in word { engine.perform(.character(String(character)), in: document) }
            engine.perform(.space, in: document)
        }
    }

    var summary: String {
        func percent(_ count: Int) -> String { String(format: "%.1f%%", Double(count) * 100 / Double(max(words, 1))) }
        return "words=\(words) top1=\(percent(first)) top3=\(percent(topThree))"
    }
}

@MainActor
struct SimulatedUser {
    let grid: KeyGrid
    let noise: Double
    let bias: [Character: (x: Double, y: Double)]
    var random: SplitMix64

    /// Offsets in key pitches: m drifts toward n, b toward the space bar, o toward i, and every tap lands a bit low.
    static let thumbs: [Character: (x: Double, y: Double)] = ["m": (-0.4, 0.1), "b": (0, 0.55), "o": (-0.45, 0.1), "*": (0, 0.1)]
    static let shifted: [Character: (x: Double, y: Double)] = ["m": (-0.4, 0.4), "b": (0, 0.7), "o": (0.4, 0.3), "e": (-0.45, 0.3), "*": (0.1, 0.3)]

    init(width: Double, noise: Double, seed: UInt64, bias: [Character: (x: Double, y: Double)] = [:]) {
        let layout = Layouts.layout(for: LayoutContext(device: .phone, layer: .letters))
        grid = KeyGrid(layout, width: width, metrics: KeyboardMetrics.phone(width: width).grid, signature: "eval")
        self.noise = noise
        self.bias = bias
        random = SplitMix64(seed: seed)
    }

    mutating func tap(_ character: Character) -> (Double, Double) {
        let frame = grid.frame(of: String(character))!
        let pitchX = character == " " ? 45.0 : frame.width + 6, pitchY = frame.height + 11
        let offset = bias[character] ?? bias["*"] ?? (0, 0)
        return (frame.midX + (offset.x + random.gaussian() * noise) * pitchX,
                frame.midY + (offset.y + random.gaussian() * noise) * pitchY)
    }
}

struct Score: CustomStringConvertible {
    var words = 0, raw = 0, corrected = 0, topThree = 0, predicted = 0, fixed = 0, broken = 0
    var brokenWords: [String] = []

    mutating func add(word: String, typed: String, final: String, shown: [String], predictions: [String]) {
        words += 1
        if predictions.contains(word) { predicted += 1 }
        if typed == word { raw += 1 }
        if final == word { corrected += 1 }
        if shown.contains(word) { topThree += 1 }
        if typed != word, final == word { fixed += 1 }
        if typed == word, final != word {
            broken += 1
            brokenWords.append("\(word)→\(final)")
        }
    }

    private func percent(_ count: Int) -> String {
        String(format: "%.1f%%", Double(count) * 100 / Double(max(words, 1)))
    }

    var summary: String { "\(percent(raw))/\(percent(corrected))" }

    var description: String {
        "words=\(words) raw=\(percent(raw)) autocorrect=\(percent(corrected)) top3=\(percent(topThree)) next3=\(percent(predicted)) fixed=\(fixed) broken=\(broken) \(brokenWords.prefix(8))"
    }
}

struct SplitMix64 {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func uniform() -> Double {
        Double(next() >> 11) / Double(1 << 53)
    }

    mutating func gaussian() -> Double {
        sqrt(-2 * log(max(uniform(), .leastNormalMagnitude))) * cos(2 * .pi * uniform())
    }
}

final class Document: TextDocument {
    private(set) var text = ""

    var textBeforeInput: String? { text }
    var textAfterInput: String? { nil }
    func insert(_ value: String) { text += value }
    func deleteBackward(_ count: Int) { text.removeLast(min(count, text.count)) }
    func moveCursor(by offset: Int) {}
}
