import Foundation
import KeyboardCore
struct Trial: Decodable {
    let id, split, word: String
    let samples: [SwipeSample]
    let keys: [Key]
    let study_flagged_error: Bool
    struct Key: Decodable { let letter: String; let x,y: Double }
}
let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[1])
let trials = try JSONDecoder().decode([Trial].self, from: Data(contentsOf: root.appendingPathComponent("eval/private/human-swipes.json")))
let resources = root.appendingPathComponent("Vendor/HexKeyboard/Sources/KeyboardUI/Resources")
let lexicon = Lexicon(bytes: [UInt8](try Data(contentsOf: resources.appendingPathComponent("en.lexicon"))))!
let spatialWeight = args.first { $0.hasPrefix("--spatial=") }.flatMap { Double($0.dropFirst(10)) } ?? 0.4
let decoder = LocalSwipeDecoder(words: lexicon.swipeWords, maximumFinalists: 24, spatialWeight: spatialWeight)
let split = args.contains("--holdout") ? "holdout" : "tune"
var reports: [[String:Any]] = [], errors: [[String:Any]] = []
for group in ["all", "study_not_flagged", "study_flagged"] {
    var words = 0, right = 0, top3 = 0, rejected = 0, times: [Double] = []
    for trial in trials where trial.split == split {
        if group == "study_not_flagged" && trial.study_flagged_error { continue }
        if group == "study_flagged" && !trial.study_flagged_error { continue }
        let keys = trial.keys.map { SwipeKey(letter:$0.letter,x:$0.x,y:$0.y) }
        let start = ProcessInfo.processInfo.systemUptime
        let result = decoder.decode(samples:trial.samples,keys:keys)
        times.append((ProcessInfo.processInfo.systemUptime-start)*1000)
        words += 1
        if result.first == trial.word { right += 1 }
        else if split == "tune" && group == "all" { errors.append(["id":trial.id,"word":trial.word,"result":result]) }
        if result.contains(trial.word) { top3 += 1 }
        if result.isEmpty { rejected += 1 }
    }
    times.sort()
    reports.append(["group":group,"words":words,"top1":right,"top3":top3,"rejected":rejected,
        "top1_percent":100*Double(right)/Double(words),"p50_ms":times[times.count/2],"p95_ms":times[Int(Double(times.count)*0.95)]])
}
if split == "tune" { try JSONSerialization.data(withJSONObject: errors).write(to: root.appendingPathComponent("eval/private/human-swipe-tune-errors.json")) }
let report: [String:Any] = ["protocol":"usual-human-swipe-v1","split":split,"spatial_weight":spatialWeight,"reports":reports,
    "limitation":"Real traces from a different web keyboard, participant-disjoint audit. No context or Paul vocabulary. Includes study-flagged errors; not Paul/iPhone/Apple accuracy."]
print(String(data:try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
