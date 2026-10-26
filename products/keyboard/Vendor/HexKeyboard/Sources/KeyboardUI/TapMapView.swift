import UIKit
import KeyboardCore

/// The keyboard at its real size with what the touch model learned drawn over it: where your taps for each key land
/// (`aim`), or how many of them land on the key you meant (`accuracy`). Tapping a key selects it.
public final class TapMapView: UIView {
    public enum Mode { case aim, accuracy }

    public var mode = Mode.aim { didSet { if mode != oldValue { refresh(animated: true) } } }
    public var onSelect: (Aim?) -> Void = { _ in }
    public private(set) var aims: [Aim] = []
    public private(set) var selected: Aim?

    private let canvas = UIView()
    private let keyboard = KeyboardView()
    private let marks = TapMarksView()
    private var context = LayoutContext(device: .phone, layer: .letters)
    private var grid = KeyGrid()
    private var size = CGSize.zero
    private let selection = UISelectionFeedbackGenerator()

    override public init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 32 / 255, alpha: 1) : UIColor(red: 226 / 255, green: 227 / 255, blue: 232 / 255, alpha: 1) }
        layer.cornerRadius = 26
        layer.cornerCurve = .continuous
        clipsToBounds = true
        keyboard.isUserInteractionEnabled = false
        marks.isUserInteractionEnabled = false
        marks.isOpaque = false
        canvas.addSubview(keyboard)
        canvas.addSubview(marks)
        addSubview(canvas)
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (self: Self, _) in self.refresh(animated: false) }
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Lays out the keys of `context` as they are on a `screen`-sized device and draws `touches` over them.
    public func show(_ touches: TouchModel, on context: LayoutContext, screen: CGSize) {
        let short = min(screen.width, screen.height), long = max(screen.width, screen.height)
        let width = context.isLandscape ? long : short, height = context.isLandscape ? short : long
        let metrics = KeyboardMetrics.for(context.device, width: width, height: height, style: .current)
        let layout = Layouts.layout(for: context)
        self.context = context
        grid = KeyGrid(layout, width: width, metrics: metrics.grid, signature: context.signature)
        size = CGSize(width: width, height: metrics.height(rows: layout.rows.count, hasNumberRow: layout.hasNumberRow))
        aims = touches.aims(on: grid)
        selected = selected.flatMap { old in aims.first { $0.key == old.key } }
        let faces = KeyFaceContext(device: context.device, layer: .letters, kind: .text, shift: .off, returnKind: .default, returnEnabled: true)
        canvas.transform = .identity
        canvas.frame = CGRect(origin: .zero, size: size)
        keyboard.frame = canvas.bounds
        marks.frame = canvas.bounds
        keyboard.update(layout: layout, signature: context.signature, metrics: metrics, faces: faces, theme: theme)
        keyboard.layoutIfNeeded()
        invalidateIntrinsicContentSize()
        setNeedsLayout()
        refresh(animated: false)
    }

    public func select(_ aim: Aim?) {
        selected = aim
        refresh(animated: true)
        onSelect(aim)
    }

    override public var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: size.width > 0 ? size.height * scale(for: bounds.width > 0 ? bounds.width : size.width) : 0)
    }

    private func scale(for width: CGFloat) -> CGFloat {
        size.width > 0 ? min(1, width / size.width) : 1
    }

    override public func layoutSubviews() {
        super.layoutSubviews()
        let scale = scale(for: bounds.width)
        canvas.transform = CGAffineTransform(scaleX: scale, y: scale)
        canvas.center = CGPoint(x: bounds.midX, y: bounds.midY)
        if abs(bounds.height - size.height * scale) > 0.5 { invalidateIntrinsicContentSize() }
    }

    private var theme: KeyboardTheme { KeyboardTheme.current(for: traitCollection, appearance: nil) }

    private func refresh(animated: Bool) {
        keyboard.update(layout: keyboard.layout, signature: keyboard.signature, metrics: keyboard.metrics, faces: keyboard.faceContext, theme: theme)
        for view in keyboard.keyViews { view.showsLabel = mode == .aim && view.key.label == nil }
        marks.draw(aims, keys: Array(grid.rows.joined()), mode: mode, selected: selected, theme: theme)
        guard animated else { return marks.setNeedsDisplay() }
        UIView.transition(with: canvas, duration: 0.2, options: [.transitionCrossDissolve, .allowUserInteraction]) {
            self.marks.setNeedsDisplay()
        }
    }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: canvas)
        let hit = grid.index(atX: point.x, y: point.y).map { grid.rows[$0.row][$0.key].key }
        let aim = aims.first { $0.key == hit }
        selection.selectionChanged()
        select(aim == nil || aim?.key == selected?.key ? nil : aim)
    }
}

private final class TapMarksView: UIView {
    private var aims: [Aim] = []
    private var keys: [(key: Key, frame: Rect)] = []
    private var mode = TapMapView.Mode.aim
    private var selected: Aim?
    private var theme = KeyboardTheme.lightCurrent

    func draw(_ aims: [Aim], keys: [(key: Key, frame: Rect)], mode: TapMapView.Mode, selected: Aim?, theme: KeyboardTheme) {
        self.aims = aims
        self.keys = keys
        self.mode = mode
        self.selected = selected
        self.theme = theme
    }

    override func draw(_ rect: CGRect) {
        switch (mode, selected) {
        case (.aim, _): drawAim()
        case (.accuracy, nil): drawShares(aims.map { ($0.key, $0.onTarget) }, target: nil)
        case (.accuracy, let selected?): drawShares(selected.landing, target: selected.key)
        }
    }

    /// Each key's recent taps as dots, the ellipse that holds half its taps, and a line from the key's center to
    /// the center of its taps.
    private func drawAim() {
        let half = (2 * log(2.0)).squareRoot()
        for aim in aims where aim.key.label != " " {
            label(aim.key, in: aim.frame, share: nil, emphasized: false)
        }
        for aim in aims {
            let alpha: CGFloat = selected.map { $0.key == aim.key ? 1 : 0.25 } ?? 1
            let center = CGPoint(x: aim.center.x, y: aim.center.y)
            let origin = CGPoint(x: aim.frame.midX, y: aim.frame.midY)

            tintColor.withAlphaComponent(0.45 * alpha).setFill()
            for tap in aim.recent {
                UIBezierPath(ovalIn: CGRect(x: tap.x - 2, y: tap.y - 2, width: 4, height: 4)).fill()
            }

            let (major, minor, angle) = Self.axes(of: aim.spread)
            let ring = UIBezierPath(ovalIn: CGRect(x: -major * half, y: -minor * half, width: 2 * major * half, height: 2 * minor * half))
            ring.apply(CGAffineTransform(rotationAngle: angle).concatenating(CGAffineTransform(translationX: center.x, y: center.y)))
            tintColor.withAlphaComponent(0.12 * alpha).setFill()
            ring.fill()
            tintColor.withAlphaComponent(0.9 * alpha).setStroke()
            ring.lineWidth = selected?.key == aim.key ? 2 : 1.25
            ring.stroke()

            let drift = UIBezierPath()
            drift.move(to: origin)
            drift.addLine(to: center)
            drift.lineWidth = 1.5
            drift.lineCapStyle = .round
            drift.stroke()

            UIColor.secondaryLabel.withAlphaComponent(alpha).setStroke()
            let cross = UIBezierPath()
            cross.move(to: CGPoint(x: origin.x - 3, y: origin.y))
            cross.addLine(to: CGPoint(x: origin.x + 3, y: origin.y))
            cross.move(to: CGPoint(x: origin.x, y: origin.y - 3))
            cross.addLine(to: CGPoint(x: origin.x, y: origin.y + 3))
            cross.lineWidth = 1
            cross.stroke()

            let dot = UIBezierPath(ovalIn: CGRect(x: center.x - 3, y: center.y - 3, width: 6, height: 6))
            theme.key.ui.withAlphaComponent(alpha).setStroke()
            dot.lineWidth = 3
            dot.stroke()
            tintColor.withAlphaComponent(alpha).setFill()
            dot.fill()
        }
    }

    /// A share of taps on each key: misses tinted by how many, the key that was meant in the accent color.
    private func drawShares(_ shares: [(key: Key, share: Double)], target: Key?) {
        let byKey = Dictionary(shares.map { ($0.key, $0.share) }) { first, _ in first }
        for (key, frame) in keys {
            guard let share = byKey[key], share >= 0.005 || target == nil else {
                label(key, in: frame, share: nil, emphasized: false)
                continue
            }
            let isTarget = key == target
            let miss = target == nil ? 1 - share : isTarget ? 0 : share
            let color = isTarget ? tintColor.withAlphaComponent(0.3) : TapMapPalette.miss.withAlphaComponent(min(miss / 0.25, 1) * 0.85)
            color.setFill()
            UIBezierPath(roundedRect: CGRect(frame), cornerRadius: 8).fill()
            label(key, in: frame, share: share, emphasized: miss >= 0.125)
        }
    }

    private func label(_ key: Key, in frame: Rect, share: Double?, emphasized: Bool) {
        let rect = CGRect(frame)
        let name = NSAttributedString(string: TapMapPalette.name(of: key), attributes: [
            .font: UIFont.systemFont(ofSize: share == nil ? (key.label?.count == 1 && key.label != " " ? 20 : 13) : 11),
            .foregroundColor: share == nil ? UIColor.label.withAlphaComponent(0.3) : UIColor.secondaryLabel,
        ])
        guard let share else {
            name.draw(at: CGPoint(x: rect.midX - name.size().width / 2, y: rect.midY - name.size().height / 2))
            return
        }
        name.draw(at: CGPoint(x: rect.minX + 5, y: rect.minY + 3))
        let number = NSAttributedString(string: TapMapPalette.percent(share, sign: false), attributes: [
            .font: UIFont.monospacedDigitSystemFont(ofSize: 15, weight: emphasized ? .semibold : .regular),
            .foregroundColor: UIColor.label,
        ])
        let size = number.size()
        number.draw(at: CGPoint(x: rect.midX - size.width / 2, y: rect.maxY - size.height - 4))
    }

    static func axes(of spread: (xx: Double, xy: Double, yy: Double)) -> (CGFloat, CGFloat, CGFloat) {
        let mid = (spread.xx + spread.yy) / 2
        let radius = (((spread.xx - spread.yy) / 2) * ((spread.xx - spread.yy) / 2) + spread.xy * spread.xy).squareRoot()
        let angle = atan2(2 * spread.xy, spread.xx - spread.yy) / 2
        return (CGFloat((mid + radius).squareRoot()), CGFloat(max(mid - radius, 0).squareRoot()), CGFloat(angle))
    }
}

public enum TapMapPalette {
    public static let miss = UIColor {
        $0.userInterfaceStyle == .dark
            ? UIColor(red: 0xD9 / 255, green: 0x59 / 255, blue: 0x26 / 255, alpha: 1)
            : UIColor(red: 0xEB / 255, green: 0x68 / 255, blue: 0x34 / 255, alpha: 1)
    }

    public static func percent(_ share: Double, sign: Bool = true) -> String {
        let value = share > 0 && share < 0.01 ? "<1" : "\(Int((share * 100).rounded()))"
        return sign ? value + "%" : value
    }

    public static func name(of key: Key) -> String {
        switch key.action {
        case .character(let value): value
        case .space: "space"
        case .delete: "delete"
        case .shift, .capsLock: "shift"
        case .return: "return"
        case .tab: "tab"
        case .layer(.letters): "ABC"
        case .layer(.numbers): "123"
        case .layer(.symbols): "#+="
        case .nextKeyboard: "globe"
        case .dismiss: "hide"
        }
    }
}
