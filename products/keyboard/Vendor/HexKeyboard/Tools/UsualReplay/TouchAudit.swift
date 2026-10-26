import Foundation
import KeyboardCore

// A deterministic hit-test audit, not a model of Paul's thumb or an Apple comparison.
// The same visible-key positions must keep their identity before/after prediction is ready.
func touchAudit(cases: [Case], lexicon: Lexicon, seed: TypingMemory, enhancements: Bool) throws {
    var prefixes = Set([""])
    for item in cases where item.split == "tune" {
        for word in item.noisy.lowercased().split(whereSeparator: { !$0.isLetter }) {
            for count in 1...max(1, word.count) { prefixes.insert(String(word.prefix(count))) }
        }
    }
    let selected = Array(prefixes.sorted().prefix(160))
    var reports: [[String: Any]] = []
    for width in [375.0, 402.0, 440.0] {
        let grid = KeyGrid(Layouts.layout(for: LayoutContext(device: .phone, layer: .letters)),
                           width: width, metrics: KeyboardMetrics.phone(width: width).grid,
                           signature: "audit-\(width)")
        var changed = 0, count = 0
        for prefix in selected {
            let document = Document()
            var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
            engine.defersSuggestions = true
            engine.corrector = Corrector(source: lexicon)
            engine.corrector?.usualEnhancements = enhancements
            engine.corrector?.memory = seed
            engine.use(grid)
            engine.documentChanged(document)
            for c in prefix { engine.perform(.character(String(c)), in: document) }
            if var job = engine.suggestionJob() { job.run(); engine.finish(job) }
            for row in grid.rows {
                for item in row where item.key.label != nil {
                    for u in [0.05, 0.25, 0.5, 0.75, 0.95] {
                        for v in [0.05, 0.25, 0.5, 0.75, 0.95] {
                            let x = item.frame.x + u * item.frame.width
                            let y = item.frame.y + v * item.frame.height
                            let hit = engine.key(atX: x, y: y, in: grid)
                            let result = hit.map { grid.rows[$0.row][$0.key].key.label }
                            count += 1
                            if result != item.key.label { changed += 1 }
                        }
                    }
                }
            }
        }
        reports.append(["width_points": width, "positions_tested": count,
                        "visible_key_reassigned": changed,
                        "visible_key_retained_percent": 100 * (1 - Double(changed) / Double(count))])
    }
    let report: [String: Any] = ["protocol": "visible-key-identity-v1", "prefixes": selected.count,
        "protects_visible_key_faces": enhancements,
        "source": "first 160 sorted prefixes of frozen tuning inputs; personal seed; fresh touch model",
        "limitation": "Synthetic geometric invariant; does not measure human accuracy, speed or Apple parity.",
        "reports": reports]
    print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
}
