import Foundation
import SQLite3
import TelegraphCore

// telegraph — Mac side of Telegraph.
//   telegraph import [sources] -o me.telegraph     learn a lexicon to AirDrop to the phone
//   telegraph eval   [sources] [--jev]              replay held-out messages as first-letter taps
//   telegraph export [sources] -o messages.json     dump short messages for offline analysis
// Sources: --imessage  --claude  --codex  --mbox PATH [--me EMAIL]  --file PATH (repeatable)
// Background vocabulary: --background PATH (a paul-corpus style sqlite; assistant turns).
// Jev key: TYPESAFE_API_KEY in the environment, or --key-file PATH. Jev calls are paid.

let home = FileManager.default.homeDirectoryForCurrentUser
var args = Array(CommandLine.arguments.dropFirst())
let command = args.isEmpty ? "help" : args.removeFirst()

func flag(_ name: String) -> Bool {
    if let i = args.firstIndex(of: name) { args.remove(at: i); return true }
    return false
}

func values(_ name: String) -> [String] {
    var out: [String] = []
    while let i = args.firstIndex(of: name), i + 1 < args.count {
        out.append(args[i + 1])
        args.removeSubrange(i...(i + 1))
    }
    return out
}

func value(_ name: String) -> String? { values(name).last }

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// MARK: Sources

func rows(_ path: String, _ sql: String, _ each: (OpaquePointer) -> Void) {
    var db: OpaquePointer?
    guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        fail("Can't open \(path). The terminal may need Full Disk Access.")
    }
    defer { sqlite3_close(db) }
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { fail("Query failed on \(path)") }
    defer { sqlite3_finalize(stmt) }
    while sqlite3_step(stmt) == SQLITE_ROW { each(stmt!) }
}

let tapback = ["Loved “", "Liked “", "Disliked “", "Laughed at “", "Emphasized “", "Questioned “", "Reacted "]

func iMessages() -> [Message] {
    var out: [Message] = []
    let path = home.appendingPathComponent("Library/Messages/chat.db").path
    rows(path, "select text, attributedBody, date from message where is_from_me = 1 and associated_message_type = 0") { s in
        var text = sqlite3_column_text(s, 0).map { String(cString: $0) }
        if text == nil, let blob = sqlite3_column_blob(s, 1) {
            text = attributedBodyText(Data(bytes: blob, count: Int(sqlite3_column_bytes(s, 1))))
        }
        guard let text, !tapback.contains(where: { text.hasPrefix($0) }) else { return }
        let raw = sqlite3_column_int64(s, 2)
        let seconds = raw > 1_000_000_000_000 ? Double(raw) / 1e9 : Double(raw)
        out.append(Message(text: text.replacingOccurrences(of: "\u{FFFC}", with: ""),
                           date: Date(timeIntervalSinceReferenceDate: seconds), source: "imessage"))
    }
    return out
}

/// Newer macOS stores some message text only in the typedstream `attributedBody` blob.
func attributedBodyText(_ data: Data) -> String? {
    let bytes = [UInt8](data)
    guard let r = data.range(of: Data("NSString".utf8)) else { return nil }
    var i = r.upperBound
    while i < bytes.count, bytes[i] != 0x2B { i += 1 }  // '+'
    i += 1
    guard i < bytes.count else { return nil }
    var length = Int(bytes[i]); i += 1
    if length == 0x81, i + 1 < bytes.count {
        length = Int(bytes[i]) | Int(bytes[i + 1]) << 8; i += 2
    }
    guard length > 0, i + length <= bytes.count else { return nil }
    return String(bytes: bytes[i..<(i + length)], encoding: .utf8)
}

func agentMessages(_ dir: URL, parse: (String) -> [Message]) -> [Message] {
    guard let e = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil) else { return [] }
    return e.compactMap { $0 as? URL }.filter { $0.pathExtension == "jsonl" }.flatMap { url in
        (try? String(contentsOf: url, encoding: .utf8)).map(parse) ?? []
    }
}

func gather() -> [Message] {
    var all: [Message] = []
    if flag("--imessage") {
        let m = iMessages()
        print("iMessage: \(m.count) sent")
        all += m
    }
    if flag("--claude") {
        let m = agentMessages(home.appendingPathComponent(".claude/projects"), parse: Importers.claudeJSONL)
        print("Claude Code: \(m.count) turns")
        all += m
    }
    if flag("--codex") {
        let m = ["sessions", "archived_sessions"].flatMap {
            agentMessages(home.appendingPathComponent(".codex/\($0)"), parse: Importers.codexJSONL)
        }
        print("Codex: \(m.count) turns")
        all += m
    }
    let me = value("--me")
    for path in values("--mbox") {
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { fail("Can't read \(path)") }
        let m = Importers.mbox(text, me: me)
        print("Email (\(path)): \(m.count) messages")
        all += m
    }
    for path in values("--file") {
        guard let data = FileManager.default.contents(atPath: path) else { fail("Can't read \(path)") }
        if case let .messages(m) = Importers.auto(name: path, data: data) {
            print("\(path): \(m.count) messages")
            all += m
        }
    }
    if all.isEmpty { fail("No sources. Use --imessage, --claude, --codex, --mbox PATH, or --file PATH.") }
    return all.filter { Words.isProse($0.text) }
}

func background(into lexicon: inout Lexicon) {
    guard let path = value("--background") else { return }
    var n = 0
    rows(path, "select content from messages where role = 'assistant'") { s in
        if let c = sqlite3_column_text(s, 0) { lexicon.addBackground(String(cString: c)); n += 1 }
    }
    lexicon.pruneBackground(minCount: 3, keep: 40_000)
    print("Background vocabulary: \(lexicon.background.count) words from \(n) passages")
}

func jevKey() -> String? {
    if let path = value("--key-file") {
        guard let s = try? String(contentsOfFile: path, encoding: .utf8) else { fail("Can't read key file") }
        let line = s.split(separator: "\n").first { $0.contains("TYPESAFE_API_KEY") } ?? Substring(s)
        let key = line.split(separator: "=").last.map(String.init) ?? String(line)
        return key.trimmingCharacters(in: CharacterSet(charactersIn: "\"' \n"))
    }
    return ProcessInfo.processInfo.environment["TYPESAFE_API_KEY"]
}

// MARK: Commands

func runImport() {
    guard let out = value("-o") else { fail("Need -o me.telegraph") }
    var lexicon = Lexicon()
    let baseOnly = flag("--base")
    background(into: &lexicon)
    if baseOnly {
        do { try lexicon.save(to: URL(fileURLWithPath: out)) } catch { fail("Can't write \(out): \(error)") }
        print("Base vocabulary only -> \(out)")
        return
    }
    let messages = gather().sorted { ($0.date ?? .distantPast) < ($1.date ?? .distantPast) }
    lexicon.learn(messages)
    for m in messages.filter({ $0.source == "imessage" }).suffix(5) { lexicon.learn(m.text, remember: true) }
    do { try lexicon.save(to: URL(fileURLWithPath: out)) } catch { fail("Can't write \(out): \(error)") }
    let size = (try? FileManager.default.attributesOfItem(atPath: out)[.size] as? Int) ?? 0
    print("Learned \(lexicon.wordCount) of your words from \(messages.count) messages -> \(out) (\(size / 1024) KB)")
    print("AirDrop it to the phone and open it with Telegraph.")
}

func runExport() {
    guard let out = value("-o") else { fail("Need -o messages.json") }
    let messages = gather().filter { $0.date != nil }.sorted { $0.date! < $1.date! }
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    do { try encoder.encode(messages).write(to: URL(fileURLWithPath: out)) } catch { fail("\(error)") }
    print("\(messages.count) messages -> \(out)")
}

/// How a person would enter a message: first letter per word, numbers in full.
var prefixLength = 1

func slots(for text: String) -> (slots: [Slot], truth: [String]) {
    let words = Words.words(text)
    return (words.map { Words.isNumber($0) ? .word($0) : .initial(String($0.prefix(prefixLength))) }, words)
}

struct Score {
    var words = 0, top1 = 0, top3 = 0, inPool = 0, exact = 0, messages = 0
    var actions = 0, fullTaps = 0, fixes = 0

    mutating func add(_ readings: [Reading], truth: [String], text: String) {
        messages += 1
        fullTaps += text.count
        var allRight = true
        for (r, t) in zip(readings, truth) {
            if r.source == .typed { actions += t.count + 1; continue }
            words += 1
            actions += min(t.count, prefixLength)
            if r.word == t { top1 += 1; continue }
            allRight = false
            fixes += 1
            if let k = r.options.firstIndex(of: t) {
                inPool += 1
                if k < 3 { top3 += 1; actions += 2 } else { actions += t.count + 2 }
            } else {
                actions += t.count + 2
            }
        }
        if allRight { exact += 1 }
    }

    func report(_ label: String) {
        func pct(_ n: Int, _ d: Int) -> String { d == 0 ? "–" : String(format: "%.0f%%", 100 * Double(n) / Double(d)) }
        print("\n\(label)")
        print("  word right first try:       \(pct(top1, words))")
        print("  right word in top 3:        \(pct(top1 + top3, words))")
        print("  whole message right:        \(pct(exact, messages))")
        print("  thumb actions vs typing:    \(actions) vs \(fullTaps) letters -> \(pct(fullTaps - actions, fullTaps)) fewer")
    }
}

func runEval() async {
    let holdout = Int(value("--holdout") ?? "") ?? 150
    prefixLength = Int(value("--prefix") ?? "") ?? 1
    let testSource = value("--test-source") ?? "imessage"
    let useJev = flag("--jev")
    let noGuess = flag("--no-guess")
    let maxCalls = Int(value("--max-calls") ?? "") ?? 200
    var decoder = WordDecoder()
    if let k = value("--options").flatMap(Int.init) { decoder.jevOptions = min(255, k) }
    let key = useJev ? jevKey() : nil
    if useJev && (key ?? "").isEmpty { fail("--jev needs TYPESAFE_API_KEY or --key-file") }

    var lexicon = Lexicon()
    background(into: &lexicon)
    let all = gather().filter { $0.date != nil }.sorted { $0.date! < $1.date! }
    let pool = all.filter { $0.source == testSource && Words.words($0.text).count >= 2 }
    let test = Array(pool.suffix(holdout))
    guard let cutoff = test.first?.date else { fail("No \(testSource) messages to test") }
    lexicon.learn(all.filter { $0.date! < cutoff })
    print("\nLearned from \(all.filter { $0.date! < cutoff }.count) earlier messages; replaying the last \(test.count) \(testSource) messages.")

    let predictor = Predictor(lexicon)
    let client = key.map { JevClient(key: $0, timeout: 8) }
    var local = Score(), jev = Score()
    var ms: [Int] = [], tokens = 0, calls = 0
    var examples: [(String, String, String)] = []

    for message in test {
        let (s, truth) = slots(for: message.text)
        let readings = decoder.decode(s, with: predictor)
        local.add(readings, truth: truth, text: message.text)

        if let client, calls < maxCalls,
           let req = decoder.jevRequest(s, readings: readings, before: "", recent: predictor.lexicon.recent,
                                        includeGuess: !noGuess) {
            do {
                let timed = try await client.evaluate(state: req.state, questions: req.questions)
                calls += 1
                ms.append(timed.milliseconds)
                tokens += timed.response.usage?.input_tokens ?? 0
                let better = WordDecoder.apply(timed, to: readings)
                jev.add(better, truth: truth, text: message.text)
                if examples.count < 12 {
                    examples.append((message.text, Words.render(readings.map(\.word)), Words.render(better.map(\.word))))
                }
            } catch {
                print("Jev error: \(error)")
                if calls == 0 { fail("Stopping: first Jev call failed.") }
            }
        } else if examples.count < 12 {
            examples.append((message.text, Words.render(readings.map(\.word)), ""))
        }
        predictor.learn(message.text)
    }

    local.report("On-device only (\(local.words) words)")
    if client != nil { jev.report("With Jev, \(decoder.jevOptions) options per word (\(jev.words) words)") }
    if !ms.isEmpty {
        ms.sort()
        let p = { (q: Double) in ms[min(ms.count - 1, Int(Double(ms.count) * q))] }
        print("\nJev latency from this Mac: p50 \(p(0.5)) ms, p95 \(p(0.95)) ms, max \(ms.last!) ms over \(ms.count) calls")
        print(String(format: "Jev usage: %d input tokens ≈ $%.4f at $0.042/Mtok", tokens, Double(tokens) * 0.042 / 1e6))
    }
    print("\nExamples (sent / on-device / Jev):")
    for (t, l, j) in examples { print("  \(t)\n    \(l)\n    \(j.isEmpty ? "—" : j)") }
}

/// Jev as a judge of whole sentences: code proposes the K best complete readings, Jev picks
/// (one Choice over shuffled IDs + one "fits" Noul per candidate, all in one request).
func runRerank(k: Int) async {
    let holdout = Int(value("--holdout") ?? "") ?? 150
    prefixLength = Int(value("--prefix") ?? "") ?? 1
    let testSource = value("--test-source") ?? "imessage"
    let useJev = flag("--jev")
    let key = useJev ? jevKey() : nil
    if useJev && (key ?? "").isEmpty { fail("--jev needs TYPESAFE_API_KEY or --key-file") }
    var lexicon = Lexicon()
    background(into: &lexicon)
    let all = gather().filter { $0.date != nil }.sorted { $0.date! < $1.date! }
    let test = Array(all.filter { $0.source == testSource && Words.words($0.text).count >= 2 }.suffix(holdout))
    guard let cutoff = test.first?.date else { fail("No \(testSource) messages") }
    lexicon.learn(all.filter { $0.date! < cutoff })
    let predictor = Predictor(lexicon)
    let decoder = WordDecoder()
    let client = key.map { JevClient(key: $0, timeout: 8) }
    print("\nRerank: \(k) whole-sentence candidates per message, \(test.count) \(testSource) messages, prefix \(prefixLength)")

    func acc(_ c: [String], _ t: [String]) -> Double {
        Double(zip(c, t).filter { $0 == $1 }.count) / Double(max(1, t.count))
    }
    var n = 0.0, local = 0.0, ceiling = 0.0, choice = 0.0, noul = 0.0, both = 0.0
    var exactLocal = 0, exactCeiling = 0, exactChoice = 0, exactBoth = 0
    var ms: [Int] = [], tokens = 0
    var rng = SystemRandomNumberGenerator()

    for message in test {
        let (s, truth) = slots(for: message.text)
        let cands = decoder.sentences(s, with: predictor, count: k)
        guard !cands.isEmpty else { continue }
        n += 1
        local += acc(cands[0], truth)
        ceiling += cands.map { acc($0, truth) }.max()!
        if cands[0] == truth { exactLocal += 1 }
        if cands.contains(truth) { exactCeiling += 1 }

        if let client {
            let ids = cands.indices.map { "C\($0)" }.shuffled(using: &rng)
            let state: JSON = .object([
                ("how_they_typed", .string("They typed only the start of each word: \(WordDecoder.pattern(s))")),
                ("candidates", .object(ids.map { id in (id, .string(Words.render(cands[Int(id.dropFirst())!]))) })),
            ])
            var questions: [String: JevQuestion] = [
                "best": .choice(.string("Which entry in `candidates` is the text message the person most likely meant to send?"),
                                options: ids.map { ($0, JSON.null) }),
            ]
            for id in ids {
                questions["fits_\(id)"] = JevQuestion(type: "noul",
                    instructions: .string("Is `candidates.\(id)` a natural, sensible text message a person would send?"),
                    criteria: .object([("true", .string("Reads like a real message: grammatical and makes sense")),
                                       ("false", .string("Word salad, ungrammatical, or nonsensical"))]))
            }
            do {
                let timed = try await client.evaluate(state: state, questions: questions)
                ms.append(timed.milliseconds)
                tokens += timed.response.usage?.input_tokens ?? 0
                let probs = timed.response.answers["best"]?.probabilities ?? [:]
                func idx(_ id: String) -> Int { Int(id.dropFirst())! }
                let byChoice = ids.max { (probs[$0] ?? 0) < (probs[$1] ?? 0) }!
                let fits = Dictionary(uniqueKeysWithValues: ids.map { ($0, timed.response.answers["fits_\($0)"]?.noul ?? 0) })
                let byNoul = ids.max { fits[$0]! < fits[$1]! }!
                let byBoth = ids.max { (probs[$0] ?? 0) * fits[$0]! < (probs[$1] ?? 0) * fits[$1]! }!
                choice += acc(cands[idx(byChoice)], truth)
                noul += acc(cands[idx(byNoul)], truth)
                both += acc(cands[idx(byBoth)], truth)
                if cands[idx(byChoice)] == truth { exactChoice += 1 }
                if cands[idx(byBoth)] == truth { exactBoth += 1 }
            } catch {
                print("Jev error: \(error)")
                if ms.isEmpty { fail("Stopping: first Jev call failed.") }
            }
        }
        predictor.learn(message.text)
    }
    func pct(_ x: Double) -> String { String(format: "%.0f%%", 100 * x / max(n, 1)) }
    func pcti(_ x: Int) -> String { String(format: "%.0f%%", 100 * Double(x) / max(n, 1)) }
    print("  words right, local top sentence:     \(pct(local))   (whole message \(pcti(exactLocal)))")
    print("  words right, best of \(k) (ceiling):    \(pct(ceiling))   (whole message \(pcti(exactCeiling)))")
    if client != nil {
        print("  words right, Jev Choice:             \(pct(choice))   (whole message \(pcti(exactChoice)))")
        print("  words right, Jev fit Noul:           \(pct(noul))")
        print("  words right, Choice x Noul:          \(pct(both))   (whole message \(pcti(exactBoth)))")
        ms.sort()
        if !ms.isEmpty {
            print("  Jev p50 \(ms[ms.count / 2]) ms, p95 \(ms[min(ms.count - 1, Int(Double(ms.count) * 0.95))]) ms; \(tokens) tokens ≈ $\(String(format: "%.4f", Double(tokens) * 0.042 / 1e6))")
        }
    }
}

switch command {
case "import": runImport()
case "export": runExport()
case "eval":
    if let k = value("--rerank").flatMap(Int.init) { await runRerank(k: k) } else { await runEval() }
default:
    print("""
    telegraph import [sources] [--background corpus.sqlite3] -o me.telegraph
    telegraph eval   [sources] [--background corpus.sqlite3] [--holdout 150] [--test-source imessage]
                     [--jev] [--options 60] [--no-guess] [--key-file PATH] [--max-calls 200]
    telegraph export [sources] -o messages.json
    sources: --imessage --claude --codex --mbox PATH [--me EMAIL] --file PATH
    """)
}
