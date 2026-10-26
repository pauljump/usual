import Testing
import UIKit
@testable import KeyboardCore
@testable import KeyboardUI

/// Replays typing as UIKit delivers it, frame by frame, with fingers that overlap: the second (third, fourth…) finger
/// lands before the first lifts, several fingers can land or lift in the same frame, and the same key is retyped.
@MainActor
struct TouchReplayTests {
    @Test func coalescedTouchesKeepInteriorTurnExactlyOnce() {
        let keyboard = Self.keyboard()
        keyboard.canStartSwipe = { true }
        let centers = Self.centers(keyboard)
        let touch = FakeTouch(at: centers["h"]!, time: 0)
        var captured: [SwipeSample] = []
        keyboard.onSwipe = { samples, _ in captured = samples }
        keyboard.touchesBegan([touch], with: nil)
        let interior = FakeTouch(at: centers["e"]!, time: 0.08)
        touch.point = centers["o"]!; touch.time = 0.16
        let event = CoalescedEvent(samples: [interior, touch])
        keyboard.touchesMoved([touch], with: event)
        keyboard.touchesEnded([touch], with: nil)
        #expect(captured.count == 3)
        #expect(captured.map(\.time) == [0, 0.08, 0.16])
        #expect(captured[1].x == keyboard.grid.swipeSample(x: centers["e"]!.x, y: centers["e"]!.y, time: 0).x)
    }
    @Test func swipeEmitsOneGestureAndNoStrayLetter() {
        let keyboard = Self.keyboard()
        keyboard.canStartSwipe = { true }
        let centers = Self.centers(keyboard)
        let touch = FakeTouch(at: centers["h"]!, time: 0)
        var letters = "", gestures = 0
        keyboard.onEvent = { if case .type(_, let tap) = $0 { letters += tap.key } }
        keyboard.onSwipe = { samples, keys in
            gestures += 1
            #expect(samples.count >= 4 && keys.count == 26)
        }
        keyboard.touchesBegan([touch], with: nil)
        for letter in Array("elo") {
            touch.point = centers[letter]!; touch.time += 0.08
            keyboard.touchesMoved([touch], with: nil)
        }
        keyboard.touchesEnded([touch], with: nil)
        #expect(gestures == 1 && letters.isEmpty)
        #expect(keyboard.swipeTrail.path == nil)
    }

    @Test func cancelledSwipeDoesNotType() {
        let keyboard = Self.keyboard()
        keyboard.canStartSwipe = { true }
        let centers = Self.centers(keyboard)
        let touch = FakeTouch(at: centers["h"]!, time: 0)
        var committed = false
        keyboard.onSwipe = { _, _ in committed = true }
        keyboard.onEvent = { if case .type = $0 { committed = true } }
        keyboard.touchesBegan([touch], with: nil)
        touch.point = centers["e"]!; touch.time = 0.1
        keyboard.touchesMoved([touch], with: nil)
        keyboard.touchesCancelled([touch], with: nil)
        #expect(!committed && keyboard.swipeTrail.path == nil)
    }

    @Test func thumbRollKeepsInitialKeyAndDecoderPosition() {
        let keyboard = Self.keyboard()
        let a = keyboard.keyViews.first { $0.key.action == .character("a") }!
        let s = keyboard.keyViews.first { $0.key.action == .character("s") }!
        let boundary = (a.frame.maxX + s.frame.minX) / 2
        let start = CGPoint(x: boundary - 1, y: a.center.y)
        let touch = FakeTouch(at: start, time: 0)
        var taps: [Tap] = []
        keyboard.onEvent = { if case .type(_, let tap) = $0 { taps.append(tap) } }
        keyboard.touchesBegan([touch], with: nil)
        touch.point.x += 3 // Cross a boundary without a deliberate slide.
        keyboard.touchesMoved([touch], with: nil)
        touch.point.x += 2 // Lift-off movement must not relabel decoder evidence either.
        keyboard.touchesEnded([touch], with: nil)
        #expect(taps.count == 1)
        #expect(taps.first?.key == "a")
        #expect(abs((taps.first?.x ?? .infinity) - Double(start.x)) < 0.000_001)
        #expect(abs((taps.first?.y ?? .infinity) - Double(start.y)) < 0.000_001)
    }

    @Test func deliberateSlideStillSelectsAnotherKey() {
        let keyboard = Self.keyboard()
        let centers = Self.centers(keyboard)
        let touch = FakeTouch(at: centers["a"]!, time: 0)
        var typed = ""
        keyboard.onEvent = { if case .type(_, let tap) = $0 { typed += tap.key } }
        keyboard.touchesBegan([touch], with: nil)
        touch.point = centers["s"]!
        keyboard.touchesMoved([touch], with: nil)
        keyboard.touchesEnded([touch], with: nil)
        #expect(typed == "s")
    }

    private static let passage = """
    noticing that some letters miss when typing very fast at least one letter per word testing should ensure it can \
    handle inputs of two hundred words per minute sustained but ideally should not even trip up with one thousand \
    how much processing is happening in between letters
    """

    @Test(arguments: [(200.0, 0.09), (1000.0, 0.06), (1000.0, 0.2)])
    func everyKeyLandsInOrder(wordsPerMinute: Double, dwell: Double) {
        var random = SeededRandom(seed: 7)
        let keyboard = Self.keyboard()
        var typed = ""
        keyboard.onEvent = { if case .type(_, let tap) = $0 { typed += tap.key } }
        let taps = Self.taps(Self.passage, wordsPerMinute: wordsPerMinute, dwell: dwell, centers: Self.centers(keyboard), random: &random)
        for frame in Self.frames(taps) {
            if !frame.began.isEmpty { keyboard.touchesBegan(frame.began, with: nil) }
            if !frame.ended.isEmpty { keyboard.touchesEnded(frame.ended, with: nil) }
        }
        #expect(typed == Self.passage)
        #expect(keyboard.tracked.isEmpty)
    }

    /// The same thumbs-low taps typed one at a time and typed fast with fingers overlapping must type the same text
    /// through the engine. A key commits when the next finger lands (rollover), so the new finger's key is read after
    /// that commit, from the key map made for the text including it.
    @Test(arguments: [(200.0, 0.12), (1000.0, 0.06)])
    func overlappingFingersTypeWhatSeparateTapsType(wordsPerMinute: Double, dwell: Double) {
        let alone = Self.typeThroughEngine(wordsPerMinute: 20, dwell: 0.05)
        let overlapping = Self.typeThroughEngine(wordsPerMinute: wordsPerMinute, dwell: dwell)
        #expect(overlapping == alone, "\(overlapping) ≠ \(alone)")
    }

    private static func typeThroughEngine(wordsPerMinute: Double, dwell: Double) -> String {
        var random = SeededRandom(seed: 11)
        let view = KeyboardView(frame: CGRect(x: 0, y: 0, width: 402, height: 226))
        var engine = TypingEngine(traits: InputTraits(autocapitalization: .none))
        engine.corrector = Corrector(source: Lexicon.english)
        let document = ReplayDocument()
        view.onGrid = { engine.use($0) }
        view.resolve = { grid, point in engine.key(atX: point.x, y: point.y, in: grid) }
        view.onEvent = { event in
            guard case .type = event else { return }
            engine.handle(event, in: document)
        }
        let layout = Layouts.layout(for: LayoutContext(device: .phone, layer: .letters))
        let faces = KeyFaceContext(device: .phone, layer: .letters, kind: .text, shift: .off, returnKind: .default, returnEnabled: true)
        view.update(layout: layout, signature: "replay", metrics: .phone(width: 402), faces: faces, theme: .lightCurrent)
        view.layoutIfNeeded()
        let pitch = view.keyViews.first { $0.key.action == .character("q") }!.frame.size
        let taps = taps(passage, wordsPerMinute: wordsPerMinute, dwell: dwell, centers: centers(view), random: &random) { point, random in
            CGPoint(x: point.x + random.gaussian() * 0.2 * (pitch.width + 6), y: point.y + (0.15 + random.gaussian() * 0.2) * (pitch.height + 11))
        }
        for frame in frames(taps) {
            if !frame.began.isEmpty { view.touchesBegan(frame.began, with: nil) }
            if !frame.ended.isEmpty { view.touchesEnded(frame.ended, with: nil) }
        }
        return document.text
    }

    private struct Press {
        let touch: FakeTouch
        let up: TimeInterval
    }

    private static func keyboard() -> KeyboardView {
        let view = KeyboardView(frame: CGRect(x: 0, y: 0, width: 402, height: 226))
        let layout = Layouts.layout(for: LayoutContext(device: .phone, layer: .letters))
        let faces = KeyFaceContext(device: .phone, layer: .letters, kind: .text, shift: .off, returnKind: .default, returnEnabled: true)
        view.update(layout: layout, signature: "replay", metrics: .phone(width: 402), faces: faces, theme: .lightCurrent)
        view.layoutIfNeeded()
        return view
    }

    private static func centers(_ view: KeyboardView) -> [Character: CGPoint] {
        var centers: [Character: CGPoint] = [:]
        for key in view.keyViews {
            switch key.key.action {
            case .character(let value) where value.count == 1: centers[Character(value)] = key.center
            case .space: centers[" "] = key.center
            default: break
            }
        }
        return centers
    }

    /// One tap per character every `60 / (wpm × 5)` s, ±30% jitter, held for `dwell` (also jittered) but released
    /// before the same key is pressed again, landing within 3 pt of the key's center.
    private static func taps(_ text: String, wordsPerMinute: Double, dwell: Double, centers: [Character: CGPoint], random: inout SeededRandom,
                             aim: (CGPoint, inout SeededRandom) -> CGPoint = { center, random in
                                 CGPoint(x: center.x + random.next(in: -3...3), y: center.y + random.next(in: -3...3))
                             }) -> [Press] {
        let interval = 60 / (wordsPerMinute * 5)
        let downs = text.indices.enumerated().map { index, _ in Double(index) * interval + random.next(in: -0.3...0.3) * interval }
        let characters = Array(text)
        return characters.indices.map { index in
            let down = max(downs[index], index > 0 ? downs[index - 1] + 0.0005 : 0)
            var up = down + dwell * (1 + random.next(in: -0.3...0.3))
            if let again = characters[(index + 1)...].firstIndex(of: characters[index]) { up = min(up, downs[again] - 0.001) }
            let point = aim(centers[characters[index]]!, &random)
            return Press(touch: FakeTouch(at: point, time: down), up: max(up, down + 0.001))
        }
    }

    /// UIKit hands touches to a view once per display frame (120 Hz): every touch that landed or lifted since the
    /// last frame arrives together, in an unordered set.
    private static func frames(_ presses: [Press]) -> [(began: Set<UITouch>, ended: Set<UITouch>)] {
        let frame = 1.0 / 120
        var frames: [Int: (began: Set<UITouch>, ended: Set<UITouch>)] = [:]
        for press in presses {
            let down = Int(press.touch.timestamp / frame), up = max(Int(press.up / frame), down + 1)
            frames[down, default: ([], [])].began.insert(press.touch)
            frames[up, default: ([], [])].ended.insert(press.touch)
        }
        return frames.keys.sorted().map { frames[$0]! }
    }
}

private final class FakeTouch: UITouch {
    var point: CGPoint
    var time: TimeInterval

    init(at point: CGPoint, time: TimeInterval) {
        self.point = point
        self.time = time
        super.init()
    }

    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { time }
    override var tapCount: Int { 1 }
}

private final class CoalescedEvent: UIEvent {
    let samples: [UITouch]
    init(samples: [UITouch]) { self.samples = samples; super.init() }
    override func coalescedTouches(for touch: UITouch) -> [UITouch]? { samples }
}

private struct SeededRandom {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next(in range: ClosedRange<Double>) -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return range.lowerBound + Double(state >> 11) / Double(1 << 53) * (range.upperBound - range.lowerBound)
    }

    mutating func gaussian() -> Double {
        sqrt(-2 * log(max(next(in: 0...1), .leastNormalMagnitude))) * cos(2 * .pi * next(in: 0...1))
    }
}

private final class ReplayDocument: TextDocument {
    private(set) var text = ""

    var textBeforeInput: String? { text }
    var textAfterInput: String? { nil }
    func insert(_ value: String) { text += value }
    func deleteBackward(_ count: Int) { text.removeLast(min(count, text.count)) }
    func moveCursor(by offset: Int) {}
}
