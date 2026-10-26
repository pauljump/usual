// Adapted from nkrsn/jboard, 70b9d5af92ca4a6846db8bae18834c4cb1e2c510. MIT: Vendor/HexKeyboard/JBOARD-LICENSE.

/// Coordinates are in horizontal key pitches; time is elapsed seconds from touch-down.
public struct SwipeSample: Hashable, Codable, Sendable {
    public let x: Double
    public let y: Double
    public let time: Double
    public init(x: Double, y: Double, time: Double) { self.x = x; self.y = y; self.time = time }
}
public protocol SwipeDecoding {
    func decode(samples: [SwipeSample], precedingText: String) -> [String]
}
/// No-op decoder retained for integrations that disable swipe input.
public struct DisabledSwipeDecoder: SwipeDecoding {
    public init() {}
    public func decode(samples: [SwipeSample], precedingText: String) -> [String] { [] }
}


public struct SwipeKey: Hashable, Sendable {
    public let letter: String
    public let x: Double
    public let y: Double
    public init(letter: String, x: Double, y: Double) { self.letter = letter; self.x = x; self.y = y }
}
public struct SwipeWord: Sendable {
    public let word: String
    public let frequency: Int64
    public init(word: String, frequency: Int64) { self.word = word; self.frequency = frequency }
}

/// Shape matching on a serial background queue. Uses actual visible key centers,
/// endpoint pruning, spatial resampling and banded dynamic time warping.
public final class LocalSwipeDecoder: Sendable {
    private let buckets: [String: [SwipeWord]]
    private let maximumFinalists: Int
    private let endpointWeight: Double
    private let optimized: Bool
    private let spellings: [String: [UInt8]]
    private let contractions: Bool
    private let contextWeight: Double
    private let spatialWeight: Double
    public init(words: [SwipeWord], maximumFinalists: Int = 60, endpointWeight: Double = 0.35, optimized: Bool = false,
                contractions: Bool = false, contextWeight: Double = 0.03, spatialWeight: Double = 0.4) {
        self.spatialWeight = min(1, max(0, spatialWeight))
        self.contractions = contractions
        self.contextWeight = contextWeight
        self.optimized = optimized
        self.maximumFinalists = min(60, max(3, maximumFinalists))
        self.endpointWeight = endpointWeight
        let eligible = words.filter { Self.eligible($0.word, contractions: contractions) }
        spellings = optimized ? Dictionary(eligible.map { ($0.word, Array($0.word.utf8)) }, uniquingKeysWith: { first, _ in first }) : [:]
        buckets = Dictionary(grouping: eligible) { String($0.word.first!) + String($0.word.last!) }
    }
    private struct Point { let x: Double; let y: Double }
    public static func eligible(_ word: String, contractions: Bool = true) -> Bool {
        let letters = word.utf8.filter { (97...122).contains($0) }
        return (2...20).contains(word.count) && letters.count >= 2 &&
            word.utf8.first.map { (97...122).contains($0) } == true &&
            word.utf8.last.map { (97...122).contains($0) } == true &&
            word.utf8.allSatisfy { (97...122).contains($0) || (contractions && $0 == 39) }
    }
    private func distance(_ a: Point, _ b: Point) -> Double { ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)).squareRoot() }
    private func length(_ points: [Point]) -> Double { zip(points, points.dropFirst()).reduce(0) { $0 + distance($1.0, $1.1) } }
    private func resample(_ points: [Point], count: Int = 24) -> [Point] {
        guard let first = points.first, let last = points.last else { return [] }
        let segments = optimized ? zip(points, points.dropFirst()).map { distance($0.0, $0.1) } : []
        let total = optimized ? segments.reduce(0, +) : length(points)
        guard total > 0.001 else { return Array(repeating: first, count: count) }
        var output = [first], segment = 1, traversed = 0.0
        for index in 1..<(count - 1) {
            let target = total * Double(index) / Double(count - 1)
            while segment < points.count - 1 && traversed + (optimized ? segments[segment - 1] : distance(points[segment - 1], points[segment])) < target {
                traversed += optimized ? segments[segment - 1] : distance(points[segment - 1], points[segment]); segment += 1
            }
            let a = points[segment - 1], b = points[segment]
            let fraction = min(1, max(0, (target - traversed) / max(0.001, optimized ? segments[segment - 1] : distance(a, b))))
            output.append(Point(x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction))
        }
        output.append(last); return output
    }
    private func warpedDistance(_ a: [Point], _ b: [Point]) -> Double {
        var previous = Array(repeating: Double.infinity, count: b.count + 1); previous[0] = 0
        for i in 1...a.count {
            var current = Array(repeating: Double.infinity, count: b.count + 1)
            for j in max(1, i - 5)...min(b.count, i + 5) {
                current[j] = distance(a[i - 1], b[j - 1]) + min(previous[j - 1], previous[j] + 0.04, current[j - 1] + 0.04)
            }
            previous = current
        }
        return previous[b.count] / Double(a.count)
    }
    public func decode(samples: [SwipeSample], keys: [SwipeKey], preferred: [String] = [], personal: [String] = [],
                       context: SwipeLanguageContext? = nil) -> [String] {
        guard (2...256).contains(samples.count), keys.count == 26,
              samples.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.time.isFinite }),
              keys.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
              Set(keys.map(\.letter)).count == 26 else { return [] }
        let observed = samples.map { Point(x: $0.x, y: $0.y) }
        guard length(observed) >= 0.7, samples.last!.time - samples.first!.time <= 8,
              zip(samples, samples.dropFirst()).allSatisfy({ $0.time <= $1.time }) else { return [] }
        let centers = Dictionary(uniqueKeysWithValues: keys.map { ($0.letter, Point(x: $0.x, y: $0.y)) })
        var indexed = [Point?](repeating: nil, count: 26)
        if optimized {
            for key in keys {
                if let byte = key.letter.utf8.first, key.letter.utf8.count == 1, (97...122).contains(byte) {
                    indexed[Int(byte - 97)] = Point(x: key.x, y: key.y)
                }
            }
        }
        func endpoints(_ point: Point) -> Set<String> {
            Set(keys.sorted { distance(point, centers[$0.letter]!) < distance(point, centers[$1.letter]!) }
                .prefix(3).filter { distance(point, centers[$0.letter]!) <= 1.25 }.map(\.letter))
        }
        let starts = endpoints(observed.first!), ends = endpoints(observed.last!)
        let path = resample(observed), pathLength = length(observed)
        var scored: [(word: String, rough: Double, shape: [Point], bonus: Double)] = []
        var seen = Set<String>()
        let personalEntries = personal.compactMap { word -> SwipeWord? in
            if optimized, let first = word.first, let last = word.last,
               (!starts.contains(String(first).lowercased()) || !ends.contains(String(last).lowercased())) { return nil }
            return SwipeWord(word: word.lowercased(), frequency: 1_000_000)
        }
        let nearbyWords = starts.sorted().flatMap { first in ends.sorted().flatMap { last in buckets[first + last] ?? [] } }
        for entry in personalEntries + nearbyWords {
            guard Self.eligible(entry.word, contractions: contractions),
                  let first = entry.word.first, let last = entry.word.last,
                  starts.contains(String(first)), ends.contains(String(last)), seen.insert(entry.word).inserted else { continue }
            var template: [Point] = []
            if optimized {
                for byte in spellings[entry.word] ?? Array(entry.word.utf8) {
                    if byte == 39 { continue }
                    guard (97...122).contains(byte), let point = indexed[Int(byte - 97)] else { template = []; break }
                    if template.last.map({ distance($0, point) > 0.001 }) ?? true { template.append(point) }
                }
            } else {
                for letter in entry.word {
                    if letter == "'" { continue }
                    guard let point = centers[String(letter)] else { template = []; break }
                    if template.last.map({ distance($0, point) > 0.001 }) ?? true { template.append(point) }
                }
            }
            guard template.count >= 2 else { continue }
            let shape = resample(template)
            let spatial = zip(path, shape).reduce(0) { $0 + distance($1.0, $1.1) } / Double(path.count)
            let endpoint = (distance(observed.first!, template.first!) + distance(observed.last!, template.last!)) * endpointWeight
            let lengthPenalty = abs(Math.log((pathLength + 0.5) / (length(template) + 0.5))) * 0.18
            let bonus = (Math.log(Double(max(1, entry.frequency))) / 2.302585092994046) * 0.035 + (preferred.contains(entry.word) ? 0.12 : 0)
            scored.append((entry.word, spatial + endpoint + lengthPenalty, shape, bonus))
        }
        let shortlist = scored.sorted { $0.rough - $0.bonus < $1.rough - $1.bonus }.prefix(maximumFinalists)
        let contextualBonuses = context?.bonuses(for: shortlist.map(\.word), weight: contextWeight) ?? [:]
        let finalists = shortlist.map { item in
            (word: item.word, geometry: spatialWeight * item.rough + (1 - spatialWeight) * warpedDistance(path, item.shape),
             bonus: item.bonus + contextualBonuses[item.word, default: 0])
        }.filter { $0.geometry < 1.0 }.sorted {
            let a = $0.geometry - $0.bonus, b = $1.geometry - $1.bonus
            return a == b ? $0.word < $1.word : a < b
        }
        return Array(finalists.prefix(3).map(\.word))
    }
}
