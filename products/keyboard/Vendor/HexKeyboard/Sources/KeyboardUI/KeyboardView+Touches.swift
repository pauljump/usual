import UIKit
import KeyboardCore

extension KeyboardView {
    final class TrackedTouch {
        enum Mode { case typing, alternates, trackpad, slide, hands, swipe }

        var key: Key
        weak var keyView: KeyView?
        var mode = Mode.typing
        var flicked = false
        let start: CGPoint
        var point: CGPoint
        var typingPoint: CGPoint
        var hasSlid = false
        var lastCursorX: CGFloat
        var hold: Timer?
        var handFrame: CGRect?
        var swipeSamples: [SwipeSample] = []
        var swipeKeys: [SwipeKey] = []
        var swipeStartedAt = 0.0
        var swipeScale = 1.0

        init(keyView: KeyView, start: CGPoint) {
            self.key = keyView.key
            self.keyView = keyView
            self.start = start
            self.point = start
            self.typingPoint = start
            self.lastCursorX = start.x
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        let start = CACurrentMediaTime()
        defer { TouchTrace.shared.record("began", touches, event, since: start) }
        for touch in touches.inOrder {
            rollOver()
            let point = touch.location(in: self)
            guard let view = keyView(at: point) else { continue }
            let tracked = TrackedTouch(keyView: view, start: point)
            self.tracked[ObjectIdentifier(touch)] = tracked
            if canStartSwipe(), !UIAccessibility.isVoiceOverRunning,
               faceContext.layer == .letters, view.key.label?.first?.isLetter == true {
                tracked.swipeKeys = grid.swipeKeys
                tracked.swipeStartedAt = touch.timestamp
                tracked.swipeScale = grid.swipeSample(x: 1, y: 1, time: 0).x
                tracked.swipeSamples = [grid.swipeSample(x: point.x, y: point.y, time: 0)]
            }
            if view.key == oneHanded.key { tracked.handFrame = view.frame }
            press(view, tracked: tracked)
            onEvent(.down(view.key, tapCount: touch.tapCount))
            if case .layer = view.key.action { tracked.mode = .slide }
            scheduleHold(for: tracked)
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        let start = CACurrentMediaTime()
        defer { TouchTrace.shared.record("moved", touches, event, since: start) }
        for touch in touches {
            guard let tracked = tracked[ObjectIdentifier(touch)] else { continue }
            let point = touch.location(in: self)
            tracked.point = point
            recordSwipe(tracked, touch: touch, event: event)
            switch tracked.mode {
            case .swipe:
                drawSwipe(tracked)
            case .alternates, .hands:
                alternates.track(point)
            case .trackpad:
                let step: CGFloat = 9
                let offset = Int((point.x - tracked.lastCursorX) / step)
                if offset != 0 {
                    tracked.lastCursorX += CGFloat(offset) * step
                    onEvent(.cursor(offset: offset))
                }
            case .typing, .slide:
                if let flick = flickTarget(tracked, point) {
                    tracked.hold?.invalidate()
                    tracked.flicked = flick
                    tracked.keyView?.isFlicked = flick
                    continue
                }
                if let frame = tracked.handFrame, !frame.contains(point) {
                    tracked.handFrame = nil
                    tracked.hold?.invalidate()
                }
                if tracked.mode == .typing {
                    // A thumb rolls as it lifts. Keep its initial target/decoder coordinates
                    // until movement is deliberate; after that, retain slide-to-select.
                    if !tracked.hasSlid {
                        guard hypot(point.x - tracked.start.x, point.y - tracked.start.y) >= 8 else { continue }
                        tracked.hasSlid = true
                    }
                    tracked.typingPoint = point
                }
                guard let view = keyView(at: point), view.key != tracked.key,
                      tracked.mode == .slide || (view.key.isInput && tracked.key.isInput) else { continue }
                tracked.keyView?.isPressed = false
                tracked.key = view.key
                tracked.keyView = view
                press(view, tracked: tracked)
                guard tracked.handFrame == nil else { continue }
                tracked.hold?.invalidate()
                scheduleHold(for: tracked)
            }
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        let start = CACurrentMediaTime()
        defer { TouchTrace.shared.record("ended", touches, event, since: start) }
        for touch in touches.inOrder {
            guard let tracked = tracked.removeValue(forKey: ObjectIdentifier(touch)) else { continue }
            tracked.point = touch.location(in: self)
            recordSwipe(tracked, touch: touch, event: event)
            finish(tracked, commit: true)
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        let start = CACurrentMediaTime()
        defer { TouchTrace.shared.record("cancelled", touches, event, since: start) }
        for touch in touches {
            guard let tracked = tracked.removeValue(forKey: ObjectIdentifier(touch)) else { continue }
            finish(tracked, commit: false)
        }
    }

    private func rollOver() {
        for (id, other) in tracked where (other.mode == .typing || other.mode == .swipe) && other.key.isInput {
            tracked.removeValue(forKey: id)
            finish(other, commit: true)
        }
    }

    func cancelInputTouches() {
        let touches = Array(tracked.values)
        tracked = [:]
        touches.forEach { finish($0, commit: false) }
        swipeTrail.path = nil
    }

    private func finish(_ tracked: TrackedTouch, commit: Bool) {
        tracked.hold?.invalidate()
        callout.hide()
        let key = tracked.key
        tracked.keyView?.isPressed = false
        tracked.keyView?.isFlicked = false
        defer { onEvent(.up(key)) }

        switch tracked.mode {
        case .swipe:
            swipeTrail.path = nil
            if commit { onSwipe(tracked.swipeSamples, tracked.swipeKeys) }
        case .alternates:
            if commit, let text = alternates.selected { onEvent(.type(key, tap(tracked, text))) }
            alternates.hide()
        case .hands:
            if commit, Self.hands.indices.contains(alternates.selectedIndex) { onEvent(.pickHand(Self.hands[alternates.selectedIndex])) }
            alternates.hide()
        case .trackpad:
            setLabelsVisible(true)
        case .slide:
            if commit, key.isInput, let text = text(for: key, flicked: tracked.flicked) {
                onEvent(.slide(text))
            }
        case .typing:
            guard commit else { return }
            if let text = text(for: key, flicked: tracked.flicked) {
                onEvent(.type(key, tap(tracked, text)))
            } else if key.action == .space {
                onEvent(.type(key, tap(tracked, " ")))
            } else {
                onEvent(.trigger(key))
            }
        }
    }

    private func tap(_ tracked: TrackedTouch, _ text: String) -> Tap {
        let point = tracked.mode == .typing ? tracked.typingPoint : tracked.point
        return Tap(x: point.x, y: point.y, key: text)
    }

    private func recordSwipe(_ tracked: TrackedTouch, touch: UITouch, event: UIEvent?) {
        // UIKit's coalesced sequence already includes the main touch. Do not append it twice,
        // and never decode predicted touches: a prediction can invent a turn the thumb did not make.
        for sample in event?.coalescedTouches(for: touch) ?? [touch] {
            recordSwipe(tracked, point: sample.location(in: self), time: sample.timestamp)
        }
    }

    private func recordSwipe(_ tracked: TrackedTouch, point: CGPoint, time: Double) {
        guard !tracked.swipeSamples.isEmpty, tracked.mode == .typing || tracked.mode == .swipe else { return }
        let sample = SwipeSample(x: point.x * tracked.swipeScale, y: point.y * tracked.swipeScale,
                                 time: max(0, time - tracked.swipeStartedAt))
        guard sample.x.isFinite, sample.y.isFinite, sample.time.isFinite else { return }
        if let last = tracked.swipeSamples.last {
            guard sample.time >= last.time, sample != last else { return }
        }
        if tracked.swipeSamples.count >= 256 {
            tracked.swipeSamples = tracked.swipeSamples.enumerated().filter { $0.offset.isMultiple(of: 2) }.map(\.element)
        }
        tracked.swipeSamples.append(sample)
        let first = tracked.swipeSamples[0]
        if tracked.mode == .typing, sample.time >= 0.055, hypot(sample.x - first.x, sample.y - first.y) >= 0.7 {
            tracked.mode = .swipe
            onSwipeStarted()
            tracked.hold?.invalidate()
            tracked.keyView?.isPressed = false
            callout.hide()
        }
    }

    private func drawSwipe(_ tracked: TrackedTouch) {
        let path = UIBezierPath()
        for (index, sample) in tracked.swipeSamples.enumerated() {
            let point = CGPoint(x: sample.x / tracked.swipeScale, y: sample.y / tracked.swipeScale)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        swipeTrail.path = path.cgPath
    }

    private func press(_ view: KeyView, tracked: TrackedTouch) {
        view.isPressed = !(showsCallouts && view.key.text(shifted: false) != nil)
        show(tracked)
    }

    private func show(_ tracked: TrackedTouch) {
        guard showsCallouts, tracked.mode != .alternates, let view = tracked.keyView,
              let text = text(for: view.key, flicked: tracked.flicked) else { return callout.hide() }
        callout.show(displayed(text), over: view.frame, in: drawableBounds, metrics: metrics, theme: theme)
    }

    private func text(for key: Key, flicked: Bool) -> String? {
        key.text(shifted: faceContext.shift.isUppercase, flicked: flicked)
    }

    private func displayed(_ text: String) -> String {
        faceContext.shift.isUppercase ? text.uppercased() : text
    }

    private func flickTarget(_ tracked: TrackedTouch, _ point: CGPoint) -> Bool? {
        guard faceContext.device == .pad || faceContext.device == .compactPad,
              tracked.mode == .typing, tracked.key.secondary != nil else { return nil }
        let dy = point.y - tracked.start.y
        return abs(point.x - tracked.start.x) < metrics.keyHeight * 0.6 ? dy > metrics.keyHeight * 0.35 : nil
    }

    private static let hands: [OneHanded] = [.left, .off, .right]

    private func scheduleHold(for tracked: TrackedTouch) {
        let key = tracked.key
        if tracked.mode == .slide, tracked.handFrame != nil { return scheduleHands(for: tracked) }
        guard tracked.mode == .typing else { return }
        let isSpace = key.action == .space
        guard isSpace || key.alternates.count > 1 else { return }
        tracked.hold = Timer.scheduledTimer(withTimeInterval: isSpace ? 0.4 : 0.45, repeats: false) { [weak self, weak tracked] _ in
            MainActor.assumeIsolated {
                guard let self, let tracked, tracked.mode == .typing, let view = tracked.keyView else { return }
                if isSpace {
                    tracked.mode = .trackpad
                    view.isPressed = false
                    self.setLabelsVisible(false)
                } else {
                    tracked.mode = .alternates
                    view.isPressed = KeyboardStyle.current.dimsKeyUnderAccents
                    self.callout.hide()
                    let shown = view.key.alternates.map(self.displayed)
                    let base = self.displayed(self.text(for: view.key, flicked: false) ?? "")
                    self.alternates.show(shown, base: base, over: view.frame, in: self.drawableBounds, metrics: self.metrics, theme: self.theme)
                }
            }
        }
    }

    private func scheduleHands(for tracked: TrackedTouch) {
        tracked.hold = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self, weak tracked] _ in
            MainActor.assumeIsolated {
                guard let self, let tracked, tracked.mode == .slide, let frame = tracked.handFrame else { return }
                tracked.mode = .hands
                self.callout.hide()
                let symbols = ["keyboard.onehanded.left", "keyboard", "keyboard.onehanded.right"]
                self.alternates.show(symbols: symbols, selected: Self.hands.firstIndex(of: self.oneHanded.current) ?? 1,
                                     over: frame, in: self.drawableBounds, metrics: self.metrics, theme: self.theme)
            }
        }
    }

    private func setLabelsVisible(_ visible: Bool) {
        UIView.animate(withDuration: 0.2) {
            self.keyViews.forEach { $0.showsLabel = visible }
        }
    }
}

private extension Set<UITouch> {
    var inOrder: [UITouch] { sorted { $0.timestamp < $1.timestamp } }
}
