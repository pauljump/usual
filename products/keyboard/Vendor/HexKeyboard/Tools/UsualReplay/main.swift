import Foundation
import KeyboardCore
final class Document: TextDocument {
    var value = ""
    var textBeforeInput: String? { value }
    var textAfterInput: String? { "" }
    func insert(_ text: String) { value += text }
    func deleteBackward(_ count: Int) { value = String(value.dropLast(count)) }
    func moveCursor(by offset: Int) {}
}
struct Case: Decodable { var id: String; var noisy: String; var split: String }
let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[1])
let personal = args.contains("--personal")
let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: root.appendingPathComponent(args.first(where: { $0.hasPrefix("--cases=") }).map { String($0.dropFirst(8)) } ?? "eval/private/cases.json")))
let resources = root.appendingPathComponent("Vendor/HexKeyboard/Sources/KeyboardUI/Resources")
let lexicon = Lexicon(bytes: [UInt8](try Data(contentsOf: resources.appendingPathComponent("en.lexicon"))))!
let phrases = Phrases(bytes: [UInt8](try Data(contentsOf: resources.appendingPathComponent("en.phrases"))))!
var seed = TypingMemory()
if personal {
    let json = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent(args.first(where: { $0.hasPrefix("--seed=") }).map { String($0.dropFirst(7)) } ?? "eval/private/training.json"))) as! [String: Any]
    // Load once through Codable with the default touch model, preserving the exact same seed on iPhone.
    var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(seed)) as! [String: Any]
    object.merge(json) { _, new in new }
    seed = try JSONDecoder().decode(TypingMemory.self, from: JSONSerialization.data(withJSONObject: object))
}
if args.contains("--touch-audit") {
    try touchAudit(cases: cases, lexicon: lexicon, seed: seed, enhancements: !args.contains("--stock"))
    exit(0)
}
for item in cases where (!args.contains("--tune") || item.split == "tune") && (!args.contains("--holdout") || item.split == "holdout") {
    let doc = Document()
    var engine = TypingEngine()
    engine.settings.autoCapitalization = false
    engine.settings.smartPunctuation = false
    engine.settings.periodShortcut = false
    engine.defersSuggestions = true
    engine.corrector = Corrector(source: lexicon, phrases: phrases)
    engine.corrector?.usualEnhancements = !args.contains("--stock")
    engine.corrector?.memory = seed
    let start = Date()
    for c in item.noisy {
        engine.perform(c == " " ? .space : c == "\n" ? .return : .character(String(c)), in: doc)
    }
    // End the last word just as tapping space does; don't score the artificial terminator.
    engine.perform(.space, in: doc)
    let out: [String: Any] = ["id":item.id,"text":String(doc.value.dropLast()),"ms":Date().timeIntervalSince(start)*1000]
    print(String(data: try JSONSerialization.data(withJSONObject: out, options: .sortedKeys), encoding:.utf8)!)
}
