import Foundation

final class DeleteRepeat {
    private static let delay: TimeInterval = 0.5
    private static let characterInterval: TimeInterval = 0.1
    private static let wordInterval: TimeInterval = 0.25
    private static let charactersBeforeWords = 20

    private var timer: Timer?
    private var count = 0
    private let action: (_ words: Bool) -> Void

    init(action: @escaping (_ words: Bool) -> Void) {
        self.action = action
        schedule(after: Self.delay)
    }

    isolated deinit {
        timer?.invalidate()
    }

    private func schedule(after interval: TimeInterval) {
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.fire() }
        }
    }

    private func fire() {
        count += 1
        let words = count > Self.charactersBeforeWords
        action(words)
        schedule(after: words ? Self.wordInterval : Self.characterInterval)
    }
}
