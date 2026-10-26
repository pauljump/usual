import Foundation
import KeyboardCore

struct Message: Decodable { let id, split, level, original: String }
struct Token: Codable { let text: String; let samples: [SwipeSample]? }
struct Trial: Codable { let id, split, level: String; let tokens: [Token] }
struct Random {
    var state: UInt64 = 713291
    mutating func uniform() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 11) / Double(1 << 53)
    }
    mutating func normal() -> Double { sqrt(-2 * log(max(uniform(), 1e-12))) * cos(2 * .pi * uniform()) }
}
let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[1])
let fixture = root.appendingPathComponent("eval/private/swipe-sentences.json")
let grid = KeyGrid(Layouts.layout(for: LayoutContext(device: .phone, layer: .letters)), width: 402,
                   metrics: KeyboardMetrics.phone(width: 402).grid, signature: "swipe-sentences")
let keys = grid.swipeKeys
if args.contains("--freeze") {
    guard !FileManager.default.fileExists(atPath: fixture.path) else { fatalError("Sentence swipe fixture already frozen") }
    let messages = try JSONDecoder().decode([Message].self, from: Data(contentsOf: root.appendingPathComponent("eval/private/cases.json")))
    let regex = try NSRegularExpression(pattern: "[A-Za-z]+(?:['’][A-Za-z]+)*|[^A-Za-z]+")
    var random = Random(), trials: [Trial] = []
    // Each real message appears at both text-typo rates; take it once, then synthesize both gesture rates.
    var seen = Set<String>()
    for message in messages where seen.insert(message.split + message.original).inserted {
        let text = message.original as NSString
        for (level, noise) in [("normal", 0.08), ("rough", 0.22)] {
            let tokens = regex.matches(in: message.original, range: NSRange(location: 0, length: text.length)).map { match -> Token in
                let original = text.substring(with: match.range)
                let word = original.lowercased().replacingOccurrences(of: "’", with: "'")
                guard LocalSwipeDecoder.eligible(word) else { return Token(text: original, samples: nil) }
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
                let raw = points
                for i in 1..<(points.count - 1) {
                    points[i] = ((raw[i-1].x + 2 * raw[i].x + raw[i+1].x) / 4,
                                 (raw[i-1].y + 2 * raw[i].y + raw[i+1].y) / 4)
                }
                return Token(text: original, samples: points.enumerated().map {
                    SwipeSample(x: $0.element.x, y: $0.element.y, time: Double($0.offset) * 0.015)
                })
            }
            trials.append(Trial(id: message.id + "-" + level, split: message.split, level: level, tokens: tokens))
        }
    }
    try JSONEncoder().encode(trials).write(to: fixture)
    print("Frozen \(trials.count) sentence gestures")
    exit(0)
}
let trials = try JSONDecoder().decode([Trial].self, from: Data(contentsOf: fixture))
let resources = root.appendingPathComponent("Vendor/HexKeyboard/Sources/KeyboardUI/Resources")
let lexicon = Lexicon(bytes: [UInt8](try Data(contentsOf: resources.appendingPathComponent("en.lexicon"))))!
let phrases = Phrases(bytes: [UInt8](try Data(contentsOf: resources.appendingPathComponent("en.phrases"))))!
var seed = try JSONSerialization.jsonObject(with: JSONEncoder().encode(TypingMemory())) as! [String: Any]
let training = try JSONSerialization.jsonObject(with: Data(contentsOf: resources.appendingPathComponent("personal-memory.json"))) as! [String: Any]
seed.merge(training) { _, new in new }
let memory = try JSONDecoder().decode(TypingMemory.self, from: JSONSerialization.data(withJSONObject: seed))
let personal = memory.counts.filter { $0.value > 1 }.keys.sorted()
let weight = args.first { $0.hasPrefix("--weight=") }.flatMap { Double($0.dropFirst(9)) } ?? 0.03
let baseline = args.contains("--baseline")
let contractions = !baseline && !args.contains("--no-contractions")
let useContext = !baseline && !args.contains("--no-context")
let spatialWeight = args.first { $0.hasPrefix("--spatial=") }.flatMap { Double($0.dropFirst(10)) } ?? 0.4
let decoder = LocalSwipeDecoder(words: lexicon.swipeWords, maximumFinalists: 24, contractions: contractions, contextWeight: weight, spatialWeight: spatialWeight)
let split = args.contains("--holdout") ? "holdout" : "tune"
var reports: [[String: Any]] = [], errors: [[String: Any]] = []
for level in ["normal", "rough"] {
    var times: [Double] = [], right = 0, top3 = 0, rejected = 0, words = 0, exact = 0, messages = 0
    var contractionCount = 0, contractionRight = 0
    for trial in trials where trial.split == split && trial.level == level {
        var entered = "", allRight = true
        messages += 1
        for token in trial.tokens {
            guard let samples = token.samples else { entered += token.text; continue }
            let answer = token.text.lowercased().replacingOccurrences(of: "’", with: "'")
            let start = ProcessInfo.processInfo.systemUptime
            let context = useContext ? SwipeLanguageContext(lexicon: lexicon, phrases: phrases, memory: memory, precedingText: entered) : nil
            let result = decoder.decode(samples: samples, keys: keys, personal: personal, context: context)
            times.append((ProcessInfo.processInfo.systemUptime - start) * 1000)
            words += 1
            if result.first == answer { right += 1 } else {
                allRight = false
                if split == "tune" { errors.append(["id": trial.id,"word": answer,"result":result]) }
            }
            if result.contains(answer) { top3 += 1 }
            if result.isEmpty { rejected += 1 }
            if answer.contains("'") {
                contractionCount += 1
                if result.first == answer { contractionRight += 1 }
            }
            // Feed the decoder's actual preceding output, never the intended answer, into the next word.
            entered += result.first ?? "[unrecognized]"
        }
        if allRight { exact += 1 }
    }
    times.sort()
    reports.append(["level": level,"words": words,"top1":right,"top3":top3,
        "top1_percent":100*Double(right)/Double(words),"top3_percent":100*Double(top3)/Double(words),
        "whole_message_words_right":exact,"messages":messages,"rejected":rejected,
        "contractions":contractionCount,"contractions_right":contractionRight,
        "p50_ms":times[times.count/2],"p95_ms":times[min(times.count-1,Int(Double(times.count)*0.95))]])
}
if split == "tune" { try JSONSerialization.data(withJSONObject: errors).write(to: root.appendingPathComponent("eval/private/swipe-sentence-tuning-errors.json")) }
let report: [String: Any] = ["protocol":"usual-swipe-sentences-v2","seed":713291,"split":split,
    "baseline_build6":baseline,"context":useContext,"contractions":contractions,"context_weight":weight,"spatial_weight":spatialWeight,
    "reports":reports,"limitation":"Synthetic sequential message gestures. Only eligible swiped words scored; punctuation, casing and unsupported characters supplied unchanged. Whole-message metric is all eligible words correct, not exact text or human accuracy. Context uses preceding decoded output, not reference answers."]
print(String(data: try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
