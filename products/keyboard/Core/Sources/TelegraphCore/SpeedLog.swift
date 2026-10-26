import Foundation

/// On-device record of how fast messages actually got written, for the two-week test
/// (Telegraph must reach 1.5x the person's own one-thumb typing speed, or it stops).
public struct SpeedEvent: Codable, Sendable {
    public enum Kind: String, Codable, Sendable { case telegraph, typed }

    public var kind: Kind
    public var at: Date
    public var characters: Int
    public var seconds: Double
    /// Thumb actions spent: taps, picks, and spelled letters.
    public var actions: Int?
    /// Words the person had to fix by picking an alternative or spelling.
    public var fixes: Int?
    public var jevMilliseconds: Int?

    public init(kind: Kind, at: Date = Date(), characters: Int, seconds: Double, actions: Int? = nil,
                fixes: Int? = nil, jevMilliseconds: Int? = nil) {
        self.kind = kind
        self.at = at
        self.characters = characters
        self.seconds = seconds
        self.actions = actions
        self.fixes = fixes
        self.jevMilliseconds = jevMilliseconds
    }

    /// Standard text-entry words: five characters per word.
    public var wpm: Double { seconds > 0 ? Double(characters) / 5 / (seconds / 60) : 0 }
}

public enum SpeedLog {
    public static func append(_ event: SpeedEvent, to url: URL) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard var line = try? encoder.encode(event) else { return }
        line.append(UInt8(ascii: "\n"))
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: line)
        } else {
            try? line.write(to: url, options: .atomic)
        }
    }

    public static func load(from url: URL) -> [SpeedEvent] {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return text.split(separator: "\n").compactMap { try? decoder.decode(SpeedEvent.self, from: Data($0.utf8)) }
    }

    public struct Summary: Sendable {
        public var telegraphWPM: Double?
        public var typedWPM: Double?
        public var telegraphMessages: Int
        public var typedMessages: Int
        public var medianJevMilliseconds: Int?

        public var ratio: Double? {
            guard let f = telegraphWPM, let t = typedWPM, t > 0 else { return nil }
            return f / t
        }
    }

    /// Pools characters and seconds per kind, so long messages count for what they cost.
    public static func summarize(_ events: [SpeedEvent]) -> Summary {
        func pooled(_ kind: SpeedEvent.Kind) -> (Double?, Int) {
            let xs = events.filter { $0.kind == kind && $0.seconds > 0.3 && $0.seconds < 300 }
            let chars = xs.reduce(0) { $0 + $1.characters }
            let secs = xs.reduce(0) { $0 + $1.seconds }
            return (secs > 0 ? Double(chars) / 5 / (secs / 60) : nil, xs.count)
        }
        let (f, nf) = pooled(.telegraph), (t, nt) = pooled(.typed)
        let ms = events.compactMap(\.jevMilliseconds).sorted()
        return Summary(telegraphWPM: f, typedWPM: t, telegraphMessages: nf, typedMessages: nt,
                       medianJevMilliseconds: ms.isEmpty ? nil : ms[ms.count / 2])
    }
}
