import UIKit
import KeyboardCore

/// Records how touches reach the keyboard on a real device, when `Library/Caches/touch-trace.tsv` exists in the
/// extension's container (create it with `devicectl device copy to`, read it with `copy from`). One line per touch
/// phase: when it happened, how late it arrived, how long the main thread spent on it, how many fingers were down;
/// plus every state change of the window's gesture recognizers, every host text report and the frames the keyboard is
/// laid out in. No characters and no touch positions.
final class TouchTrace: NSObject {
    static let shared = TouchTrace()

    private let url = URL.cachesDirectory.appending(path: "touch-trace.tsv")
    let isOn: Bool
    private var lines: [String] = []

    override private init() {
        isOn = FileManager.default.fileExists(atPath: url.path)
    }

    func record(_ phase: String, _ touches: Set<UITouch>, _ event: UIEvent?, since start: CFTimeInterval) {
        guard isOn else { return }
        let now = CACurrentMediaTime()
        for touch in touches {
            let id = UInt(bitPattern: ObjectIdentifier(touch).hashValue) % 10_000
            lines.append(String(format: "%.4f\t%@\t%lu\t%.1f\t%.2f\t%ld", touch.timestamp, phase, id, (start - touch.timestamp) * 1000,
                                (now - start) * 1000, event?.allTouches?.count ?? 0))
        }
        if lines.count >= 200 { flush() }
    }

    /// A host report (`textDidChange`, `selectionDidChange`) and how it compared with the text the keyboard knows:
    /// lengths only.
    func record(_ report: TextState.Report, host: Int, known: Int) {
        guard isOn else { return }
        lines.append(String(format: "%.4f\ttext\t%@\t%ld\t%ld", CACurrentMediaTime(), "\(report)", host, known))
    }

    /// Something the keyboard did, like typing a key, so a trace can count taps against what they typed.
    func mark(_ name: String) {
        guard isOn else { return }
        lines.append(String(format: "%.4f\t%@", CACurrentMediaTime(), name))
    }

    /// The keyboard view's frame and those of every view and window above it, when they change: what the host gives
    /// the keyboard to draw in.
    func layout(_ view: UIView) {
        guard isOn else { return }
        let chain = sequence(first: view, next: \.superview).map { "\(type(of: $0)) \(NSCoder.string(for: $0.frame))" }
        let line = (chain + [view.window.map { "window \(NSCoder.string(for: $0.bounds)) safe \(NSCoder.string(for: $0.safeAreaInsets))" } ?? "no window"]).joined(separator: " | ")
        guard line != lastLayout else { return }
        lastLayout = line
        lines.append(String(format: "%.4f\tlayout\t%@", CACurrentMediaTime(), line))
    }

    private var lastLayout = ""

    func watch(_ window: UIWindow?) {
        guard isOn else { return }
        window?.gestureRecognizers?.filter(\.cancelsTouchesInView).forEach { $0.addTarget(self, action: #selector(recognizerChanged(_:))) }
    }

    @objc private func recognizerChanged(_ recognizer: UIGestureRecognizer) {
        lines.append(String(format: "%.4f\tgesture\t%@\t%ld", CACurrentMediaTime(), String(describing: type(of: recognizer)), recognizer.state.rawValue))
    }

    func flush() {
        guard isOn, !lines.isEmpty, let handle = try? FileHandle(forWritingTo: url) else { return }
        handle.seekToEndOfFile()
        handle.write(Data((lines.joined(separator: "\n") + "\n").utf8))
        try? handle.close()
        lines = []
    }
}
