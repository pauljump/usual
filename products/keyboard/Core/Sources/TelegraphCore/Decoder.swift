import Foundation

/// One thing the thumb did. Most taps are a word's first letter; numbers and unusual
/// words are spelled out; punctuation is literal.
public enum Slot: Hashable, Sendable {
    case initial(String)
    case word(String)
    case punct(String)

    public var isInitial: Bool { if case .initial = self { true } else { false } }
}

/// What the decoder thinks one slot is.
public struct Reading: Sendable, Equatable {
    /// Best first.
    public var options: [String]
    /// Same order as options; empty for spelled words and punctuation.
    public var probabilities: [Double]
    public var source: Source
    /// The person picked this word themselves; never re-decoded.
    public var locked: Bool

    public enum Source: String, Sendable, Codable { case typed, local, jev }

    public var word: String { options.first ?? "" }

    /// Show this word as uncertain. Suggestions only appear when looking pays off.
    public var unsure: Bool {
        guard source != .typed, !locked else { return false }
        guard let top = probabilities.first else { return true }
        let second = probabilities.dropFirst().first ?? 0
        return !(top >= Gate.sureAt && top >= Gate.margin * second)
    }
}

public enum Gate {
    public static var sureAt = 0.6
    public static var margin = 2.0
}

/// Turns first-letter taps into words. Local beam search gives an instant guess; one Jev
/// request per pause picks every word in parallel against the whole message.
public struct WordDecoder: Sendable {
    public var beamWidth = 8
    public var perSlot = 30
    /// Options sent to Jev per word. Jev accepts up to 255.
    public var jevOptions = 60

    public init() {}

    struct Beam { var words: [String]; var score: Double; var prev: String }

    /// The `count` best whole-message readings, best first. These are what Jev judges:
    /// code proposes complete sentences, Jev picks the one that fits (its documented strength).
    public func sentences(_ slots: [Slot], with predictor: Predictor, count: Int) -> [[String]] {
        var wide = self
        wide.beamWidth = max(beamWidth, count * 3)
        var seen = Set<String>()
        return wide.beams(slots, predictor, [:]).map(\.words).filter { seen.insert($0.joined(separator: " ")).inserted }
            .prefix(count).map { $0 }
    }

    public func decode(_ slots: [Slot], with predictor: Predictor, keeping locked: [Int: String] = [:]) -> [Reading] {
        let best = beams(slots, predictor, locked).first?.words ?? []
        return readings(slots, best: best, predictor, locked)
    }

    func beams(_ slots: [Slot], _ predictor: Predictor, _ locked: [Int: String]) -> [Beam] {
        var beams = [Beam(words: [], score: 0, prev: Lexicon.start)]
        for (i, slot) in slots.enumerated() {
            switch slot {
            case let .word(w):
                beams = beams.map { Beam(words: $0.words + [w], score: $0.score, prev: w.lowercased()) }
            case let .punct(p):
                let reset = [".", "?", "!"].contains(p)
                beams = beams.map { Beam(words: $0.words + [p], score: $0.score, prev: reset ? Lexicon.start : $0.prev) }
            case let .initial(c):
                if let w = locked[i] {
                    beams = beams.map { Beam(words: $0.words + [w], score: $0.score, prev: w) }
                    continue
                }
                var next: [Beam] = []
                for b in beams {
                    let cands = predictor.candidates(c, after: b.prev, limit: perSlot)
                    if cands.isEmpty { next.append(Beam(words: b.words + [String(c)], score: b.score - 5, prev: String(c))) }
                    for (w, s) in cands { next.append(Beam(words: b.words + [w], score: b.score + s, prev: w)) }
                }
                beams = Array(next.sorted { $0.score > $1.score }.prefix(beamWidth))
            }
        }
        return beams
    }

    func readings(_ slots: [Slot], best: [String], _ predictor: Predictor, _ locked: [Int: String]) -> [Reading] {
        slots.enumerated().map { i, slot in
            switch slot {
            case let .word(w): return Reading(options: [w], probabilities: [], source: .typed, locked: true)
            case let .punct(p): return Reading(options: [p], probabilities: [], source: .typed, locked: true)
            case let .initial(c):
                if let w = locked[i] { return Reading(options: [w], probabilities: [1], source: .local, locked: true) }
                let prev = previousWord(in: best, before: i)
                var opts = predictor.candidates(c, after: prev, limit: jevOptions).map(\.word)
                let chosen = best.indices.contains(i) ? best[i] : opts.first ?? String(c)
                opts.removeAll { $0 == chosen }
                opts.insert(chosen, at: 0)
                return Reading(options: opts, probabilities: localProbabilities(opts, prev: prev, predictor),
                               source: .local, locked: false)
            }
        }
    }

    func previousWord(in words: [String], before i: Int) -> String {
        var j = i - 1
        while j >= 0 {
            let w = words[j]
            if [".", "?", "!"].contains(w) { return Lexicon.start }
            if !Words.closing.contains(w) { return w.lowercased() }
            j -= 1
        }
        return Lexicon.start
    }

    /// Softmax over local scores. Deliberately not trusted by the gate as much as Jev's.
    func localProbabilities(_ opts: [String], prev: String, _ p: Predictor) -> [Double] {
        let s = opts.map { p.score($0, after: prev) }
        let m = s.max() ?? 0
        let e = s.map { exp(($0 - m) * 1.5) }
        let t = e.reduce(0, +)
        return e.map { $0 / t }
    }

    // MARK: Jev

    /// The pattern of the message as typed: "s… g… see y… 7".
    public static func pattern(_ slots: [Slot]) -> String {
        slots.map {
            switch $0 {
            case let .initial(c): "\(c)…"
            case let .word(w): w
            case let .punct(p): p
            }
        }.joined(separator: " ")
    }

    /// One request, one Choice question per unlocked first-letter slot (Jev's fan-out pattern).
    public func jevRequest(_ slots: [Slot], readings: [Reading], before: String, recent: [String],
                           includeGuess: Bool = true) -> (state: JSON, questions: [String: JevQuestion])? {
        let open = slots.indices.filter { slots[$0].isInitial && !readings[$0].locked }
        guard !open.isEmpty else { return nil }
        let total = slots.filter { if case .punct = $0 { false } else { true } }.count

        var state: [(String, JSON)] = [
            ("how_they_type", .string("They type only the first letter of each word. Numbers and unusual words are typed in full.")),
            ("message_pattern", .string(Self.pattern(slots))),
        ]
        if includeGuess { state.append(("rough_guess", .string(Words.render(readings.map(\.word))))) }
        let b = before.trimmingCharacters(in: .whitespacesAndNewlines)
        if !b.isEmpty { state.append(("already_in_message_box", .string(String(b.suffix(300))))) }
        if !recent.isEmpty { state.append(("their_recent_sent_messages", .array(recent.suffix(5).map(JSON.string)))) }

        var questions: [String: JevQuestion] = [:]
        var position = 0
        for (i, slot) in slots.enumerated() {
            if case .punct = slot { continue }
            position += 1
            guard open.contains(i), case let .initial(c) = slot else { continue }
            let ask = "Which word is word \(position) of \(total) in `message_pattern`? It starts with \"\(c)\"."
            questions["w\(i)"] = .choice(.string(ask), options: readings[i].options.map { ($0, JSON.null) })
        }
        return (.object(state), questions)
    }

    /// Fold Jev's answers into the readings. Slots Jev did not answer keep the local guess.
    public static func apply(_ timed: JevClient.Timed, to readings: [Reading]) -> [Reading] {
        readings.enumerated().map { i, r in
            guard !r.locked, let a = timed.response.answers["w\(i)"], let probs = a.probabilities else { return r }
            let opts = r.options.enumerated().sorted { x, y in
                let px = probs[x.element] ?? -1, py = probs[y.element] ?? -1
                return px != py ? px > py : x.offset < y.offset
            }.map(\.element)
            return Reading(options: opts, probabilities: opts.map { probs[$0] ?? 0 }, source: .jev, locked: false)
        }
    }
}

/// The message being composed: taps in, readable text out.
public struct Composition: Sendable {
    public private(set) var slots: [Slot] = []
    public private(set) var readings: [Reading] = []
    /// Bumped on every edit so late Jev answers for an older version are ignored.
    public private(set) var revision = 0
    public private(set) var startedAt: Date?

    public init() {}

    public var isEmpty: Bool { slots.isEmpty }
    public var text: String { Words.render(readings.map(\.word)) }

    public mutating func append(_ slot: Slot, decoder: WordDecoder, predictor: Predictor) {
        if slots.isEmpty { startedAt = Date() }
        slots.append(slot)
        redecode(decoder, predictor)
    }

    public mutating func deleteLast(decoder: WordDecoder, predictor: Predictor) {
        guard !slots.isEmpty else { return }
        slots.removeLast()
        if slots.isEmpty { startedAt = nil }
        redecode(decoder, predictor)
    }

    /// The person picked an alternative: lock it and re-decode the words after it.
    public mutating func choose(_ word: String, at i: Int, decoder: WordDecoder, predictor: Predictor) {
        guard readings.indices.contains(i) else { return }
        var locked = lockedWords()
        locked[i] = word
        revision += 1
        readings = decoder.decode(slots, with: predictor, keeping: locked)
    }

    public mutating func applyJev(_ timed: JevClient.Timed, revision r: Int) {
        guard r == revision else { return }
        readings = WordDecoder.apply(timed, to: readings)
    }

    public mutating func reset() {
        slots = []
        readings = []
        revision += 1
        startedAt = nil
    }

    private func lockedWords() -> [Int: String] {
        var out: [Int: String] = [:]
        for (i, r) in readings.enumerated() where r.locked && slots[i].isInitial { out[i] = r.word }
        return out
    }

    private mutating func redecode(_ decoder: WordDecoder, _ predictor: Predictor) {
        let locked = lockedWords().filter { $0.key < slots.count }
        let previous = readings
        revision += 1
        readings = decoder.decode(slots, with: predictor, keeping: locked)
        // Keep Jev's earlier picks on screen until its next answer, so words don't flicker
        // back to the local guess on every tap.
        for i in previous.indices where i < readings.count - 1 && previous[i].source == .jev {
            readings[i] = previous[i]
        }
    }
}
