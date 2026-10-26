import Foundation
import KeyboardCore

struct Message: Decodable { var id, split, original: String }
struct Gesture: Codable { var id, word, split, level: String; var samples: [SwipeSample] }
struct Random {
    var state: UInt64 = 104731
    mutating func uniform() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 11) / Double(1 << 53)
    }
    mutating func normal() -> Double { sqrt(-2 * log(max(uniform(), 1e-12))) * cos(2 * .pi * uniform()) }
}
let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[1])
let fixture = root.appendingPathComponent("eval/private/swipe-cases.json")
let grid = KeyGrid(Layouts.layout(for: LayoutContext(device: .phone, layer: .letters)), width: 402,
                   metrics: KeyboardMetrics.phone(width: 402).grid, signature: "swipe-replay")
let keys = grid.swipeKeys
if args.contains("--freeze") {
    guard !FileManager.default.fileExists(atPath: fixture.path) else { fatalError("Swipe fixture already frozen") }
    let messages = try JSONDecoder().decode([Message].self, from: Data(contentsOf: root.appendingPathComponent("eval/private/cases.json")))
    var random = Random(), gestures: [Gesture] = []
    for split in ["tune", "holdout"] {
        var seen = Set<String>(), words: [String] = []
        for message in messages where message.split == split {
            for token in message.original.lowercased().split(whereSeparator: { !$0.isLetter && $0 != "'" && $0 != "’" }) {
                let word = String(token)
                guard (2...20).contains(word.count), word.utf8.allSatisfy({ (97...122).contains($0) }),
                      seen.insert(word).inserted else { continue }
                words.append(word)
            }
        }
        for (index, word) in words.prefix(120).enumerated() {
            for (level, noise) in [("normal", 0.08), ("rough", 0.22)] {
                let dx = random.normal() * noise / 2, dy = random.normal() * noise / 2
                let anchors = word.compactMap { c in keys.first { $0.letter == String(c) } }.map {
                    (x: $0.x + dx + random.normal() * noise, y: $0.y + dy + random.normal() * noise)
                }
                var points: [(x: Double, y: Double)] = []
                for (a, b) in zip(anchors, anchors.dropFirst()) {
                    for step in 0..<6 {
                        let f = Double(step) / 6
                        points.append((a.x + (b.x - a.x) * f + random.normal() * 0.02,
                                       a.y + (b.y - a.y) * f + random.normal() * 0.02))
                    }
                }
                points.append(anchors.last!)
                // Smooth interior corners, preserving start/end. Same frozen paths for all variants.
                let raw = points
                for i in 1..<(points.count - 1) {
                    points[i] = ((raw[i-1].x + 2 * raw[i].x + raw[i+1].x) / 4,
                                 (raw[i-1].y + 2 * raw[i].y + raw[i+1].y) / 4)
                }
                gestures.append(Gesture(id: "\(split)-\(index)-\(level)", word: word, split: split, level: level,
                    samples: points.enumerated().map { SwipeSample(x: $0.element.x, y: $0.element.y, time: Double($0.offset) * 0.015) }))
            }
        }
    }
    try JSONEncoder().encode(gestures).write(to: fixture)
    print("Frozen \(gestures.count) gestures")
    exit(0)
}
let gestures = try JSONDecoder().decode([Gesture].self, from: Data(contentsOf: fixture))
let resources = root.appendingPathComponent("Vendor/HexKeyboard/Sources/KeyboardUI/Resources")
let lexicon = Lexicon(bytes: [UInt8](try Data(contentsOf: resources.appendingPathComponent("en.lexicon"))))!
let finalists = args.contains("--fast") ? 24 : 60
let endpointWeight = args.contains("--endpoints") ? 0.7 : 0.35
let decoder = LocalSwipeDecoder(words: lexicon.swipeWords, maximumFinalists: finalists, endpointWeight: endpointWeight,
                               optimized: args.contains("--optimized"))
let training = try JSONSerialization.jsonObject(with: Data(contentsOf: resources.appendingPathComponent("personal-memory.json"))) as! [String: Any]
let counts = training["counts"] as! [String: Int]
let personal = args.contains("--personal") ? counts.filter { $0.value > 1 }.keys.sorted() : []
let split = args.contains("--holdout") ? "holdout" : "tune"
var records: [[String: Any]] = [], reports: [[String: Any]] = []
for level in ["normal", "rough"] {
    var times: [Double] = [], right = 0, top3 = 0, rejected = 0
    for gesture in gestures where gesture.split == split && gesture.level == level {
        let start = ProcessInfo.processInfo.systemUptime
        let result = decoder.decode(samples: gesture.samples, keys: keys, personal: personal)
        let ms = (ProcessInfo.processInfo.systemUptime - start) * 1000
        times.append(ms)
        if result.first == gesture.word { right += 1 }
        if result.contains(gesture.word) { top3 += 1 }
        if result.isEmpty { rejected += 1 }
        records.append(["id": gesture.id, "word": gesture.word, "result": result, "ms": ms])
    }
    times.sort()
    reports.append(["level": level, "words": times.count, "top1": right, "top3": top3,
                    "top1_percent": 100 * Double(right) / Double(times.count),
                    "top3_percent": 100 * Double(top3) / Double(times.count), "rejected": rejected,
                    "p50_ms": times[times.count / 2], "p95_ms": times[min(times.count - 1, Int(Double(times.count) * 0.95))]])
}
try JSONSerialization.data(withJSONObject: records, options: [.sortedKeys]).write(to: root.appendingPathComponent("eval/private/swipe-last.json"))
let report: [String: Any] = ["protocol": "usual-swipe-v1", "seed": 104731, "split": split,
    "finalists": finalists, "endpoint_weight": endpointWeight,
    "optimized": args.contains("--optimized"),
    "personal": args.contains("--personal"), "label": args.first { $0.hasPrefix("--label=") } ?? "baseline",
    "reports": reports, "limitation": "Frozen synthetic paths for words from sent messages. Not physical swipe accuracy, message accuracy or Apple parity."]
print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
