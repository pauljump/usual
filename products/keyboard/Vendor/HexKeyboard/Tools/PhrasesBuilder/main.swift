import Foundation
import KeyboardCore

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    print("usage: PhrasesBuilder <contexts.tsv> <out.phrases>")
    exit(1)
}
let contexts = try String(contentsOfFile: arguments[1], encoding: .utf8).split(separator: "\n").compactMap { line -> Phrases.Counts? in
    let fields = line.split(separator: "\t", omittingEmptySubsequences: false)
    guard fields.count > 3, let total = Double(fields[1]), let types = Double(fields[2]) else { return nil }
    let next = fields.dropFirst(3).compactMap { field -> (word: String, count: Double)? in
        guard let colon = field.lastIndex(of: ":"), let count = Double(field[field.index(after: colon)...]) else { return nil }
        return (String(field[..<colon]), count)
    }
    return Phrases.Counts(words: fields[0].split(separator: " ").map(String.init), total: total, types: types, next: next)
}
let phrases = Phrases(contexts: contexts)
try Data(phrases.bytes).write(to: URL(fileURLWithPath: arguments[2]))
print("\(contexts.count) contexts, \(phrases.bytes.count) bytes")
