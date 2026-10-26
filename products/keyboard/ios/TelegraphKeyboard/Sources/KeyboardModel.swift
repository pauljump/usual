import Foundation
import Observation
import UIKit

/// The keyboard's state: ordinary typing with Apple's spell checker (autocorrect on space,
/// three suggestions above the keys, sentence capitals), plus two Mini-backed actions.
/// Rephrase rewrites what's in the box in Paul's voice; ✦ turns the current line of key words
/// into what he meant (Haiku proposes readings, Jev picks one or asks).
@MainActor @Observable
final class KeyboardModel {
    enum Phase: Equatable {
        case idle, thinking, choosing, writing, rephrasing
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var readings: MiniClient.Readings?
    private(set) var suggestions: [String] = []
    var symbols = false
    var shifted = true
    var capsLock = false
    var size: MiniClient.Size {
        didSet { UserDefaults.standard.set(size.rawValue, forKey: "size") }
    }

    weak var proxy: UITextDocumentProxy?
    var hasFullAccess = false

    private let checker = UITextChecker()
    private var keys = ""
    private var keysLength = 0
    private var task: Task<Void, Never>?
    private var lastSpaceAt: Date?

    init() {
        size = MiniClient.Size(rawValue: UserDefaults.standard.string(forKey: "size") ?? "") ?? .line
    }

    func configure(fullAccess: Bool) {
        hasFullAccess = fullAccess
        refresh()
    }

    // MARK: Typing

    func letter(_ c: Character) {
        proxy?.insertText(shifted || capsLock ? String(c).uppercased() : String(c))
        if !capsLock { shifted = false }
        refresh()
    }

    func insert(_ s: String) {
        proxy?.insertText(s)
        refresh()
    }

    func delete() {
        proxy?.deleteBackward()
        refresh()
    }

    func returnKey() {
        proxy?.insertText("\n")
        refresh()
    }

    /// Space autocorrects the word just typed; a quick second space makes a period.
    func space() {
        let before = proxy?.documentContextBeforeInput ?? ""
        if let at = lastSpaceAt, Date().timeIntervalSince(at) < 0.4, before.hasSuffix(" "),
           let prev = before.dropLast().last, prev.isLetter || prev.isNumber {
            proxy?.deleteBackward()
            proxy?.insertText(". ")
            lastSpaceAt = nil
            refresh()
            return
        }
        autocorrect(before)
        proxy?.insertText(" ")
        lastSpaceAt = Date()
        refresh()
    }

    func shiftTapped() {
        if shifted && !capsLock { capsLock = true } else { shifted.toggle(); capsLock = false }
    }

    /// Tapping a suggestion replaces the word being typed, or adds the next word.
    func use(_ suggestion: String) {
        let word = currentWord()
        for _ in 0..<word.count { proxy?.deleteBackward() }
        proxy?.insertText(suggestion + " ")
        refresh()
    }

    // MARK: Spelling (Apple's UITextChecker, as in BARkey)

    private var language: String {
        UITextChecker.availableLanguages.contains("en_US") ? "en_US" : (UITextChecker.availableLanguages.first ?? "en_US")
    }

    private func currentWord() -> String {
        let before = proxy?.documentContextBeforeInput ?? ""
        return String(before.reversed().prefix { $0.isLetter || $0 == "'" || $0 == "’" }.reversed())
    }

    private func autocorrect(_ before: String) {
        let word = currentWord()
        guard word.count >= 2, word.allSatisfy(\.isLetter) else { return }
        if word.lowercased() == "i" { return }
        let range = NSRange(location: 0, length: word.utf16.count)
        guard checker.rangeOfMisspelledWord(in: word, range: range, startingAt: 0, wrap: false,
                                            language: language).location != NSNotFound,
              let guess = checker.guesses(forWordRange: range, in: word, language: language)?.first else { return }
        for _ in 0..<word.count { proxy?.deleteBackward() }
        proxy?.insertText(word.first?.isUppercase == true ? guess.prefix(1).uppercased() + guess.dropFirst() : guess)
    }

    /// Recompute suggestions and sentence capitals after every change.
    func refresh() {
        let before = proxy?.documentContextBeforeInput ?? ""
        let trimmed = before.trimmingCharacters(in: .whitespaces)
        if !capsLock {
            shifted = trimmed.isEmpty || trimmed.hasSuffix(".") || trimmed.hasSuffix("?") || trimmed.hasSuffix("!")
                || before.hasSuffix("\n")
        }
        let word = currentWord()
        if word.isEmpty {
            suggestions = before.isEmpty || shifted ? ["I", "The", "I'm"] : ["the", "I", "to"]
            return
        }
        let range = NSRange(location: 0, length: word.utf16.count)
        var out: [String] = []
        if checker.rangeOfMisspelledWord(in: word, range: range, startingAt: 0, wrap: false,
                                         language: language).location != NSNotFound {
            out += checker.guesses(forWordRange: range, in: word, language: language)?.prefix(2) ?? []
        }
        out += checker.completions(forPartialWordRange: range, in: word, language: language)?.prefix(3) ?? []
        var seen = Set<String>()
        let matched = out.map { word.first?.isUppercase == true ? $0.prefix(1).uppercased() + $0.dropFirst() : $0 }
            .filter { $0.lowercased() != word.lowercased() && seen.insert($0.lowercased()).inserted }
        suggestions = ["\u{201C}\(word)\u{201D}"] + matched.prefix(2)
    }

    // MARK: Rephrasing

    /// Rewrites everything the keyboard can see in the box, in Paul's voice.
    func rephrase() {
        guard hasFullAccess else {
            phase = .failed("Turn on Allow Full Access for Usual in Settings so it can reach the Mini.")
            return
        }
        let before = proxy?.documentContextBeforeInput ?? ""
        let after = proxy?.documentContextAfterInput ?? ""
        let text = (before + after).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            phase = .failed("Type something first.")
            return
        }
        phase = .rephrasing
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let r = try await MiniClient.rephrase(text: text)
                guard !Task.isCancelled else { return }
                proxy?.adjustTextPosition(byCharacterOffset: after.count)
                for _ in 0..<(before.count + after.count) { proxy?.deleteBackward() }
                proxy?.insertText(r.text)
                UINotificationFeedbackGenerator().notificationOccurred(r.same < 0.5 ? .warning : .success)
                phase = r.same < 0.5 ? .failed("Rephrased, but Jev thinks the meaning may have changed. Check it.") : .idle
                refresh()
            } catch {
                guard !Task.isCancelled else { return }
                phase = .failed(error.localizedDescription)
            }
        }
    }

    // MARK: Expanding

    /// The key words are the current line, up to the cursor.
    func expand() {
        guard hasFullAccess else {
            phase = .failed("Turn on Allow Full Access for Usual in Settings so it can reach the Mini.")
            return
        }
        let before = proxy?.documentContextBeforeInput ?? ""
        let line = before.components(separatedBy: "\n").last ?? ""
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            phase = .failed("Type a few key words first.")
            return
        }
        keys = trimmed
        keysLength = line.count
        let context = String(before.dropLast(line.count))
        phase = .thinking
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let r = try await MiniClient.readings(keys: keys, before: context)
                guard !Task.isCancelled else { return }
                readings = r
                if r.sure, let i = r.choice, r.readings.indices.contains(i) {
                    await write(r.readings[i])
                } else {
                    phase = .choosing
                }
            } catch {
                guard !Task.isCancelled else { return }
                phase = .failed(error.localizedDescription)
            }
        }
    }

    func choose(_ reading: String) {
        task = Task { [weak self] in await self?.write(reading) }
    }

    func cancel() {
        task?.cancel()
        phase = .idle
        readings = nil
    }

    func dismissError() { phase = .idle }

    private func write(_ reading: String) async {
        phase = .writing
        do {
            let w = try await MiniClient.write(keys: keys, reading: reading, size: size)
            guard !Task.isCancelled else { return }
            for _ in 0..<keysLength { proxy?.deleteBackward() }
            proxy?.insertText(w.text)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            phase = .idle
            readings = nil
            refresh()
        } catch {
            guard !Task.isCancelled else { return }
            phase = .failed(error.localizedDescription)
        }
    }
}
