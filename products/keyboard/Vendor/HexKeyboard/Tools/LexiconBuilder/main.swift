import Foundation
import KeyboardCore

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    print("usage: LexiconBuilder <words.tsv> <out.lexicon>")
    exit(1)
}
let counts = try String(contentsOfFile: arguments[1], encoding: .utf8).split(separator: "\n").compactMap { line -> (word: String, count: Double)? in
    let fields = line.split(separator: "\t")
    guard fields.count == 2, let count = Double(fields[1]) else { return nil }
    return (String(fields[0]), count)
}
let lexicon = Lexicon(counts: counts)
try Data(lexicon.bytes).write(to: URL(fileURLWithPath: arguments[2]))
print("\(lexicon.wordCount) words, \(lexicon.bytes.count) bytes")
