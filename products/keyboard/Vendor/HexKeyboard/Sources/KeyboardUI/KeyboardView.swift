import UIKit
import KeyboardCore

final class KeyboardView: UIView {
    var onEvent: (KeyboardEvent) -> Void = { _ in }
    var onGrid: (KeyGrid) -> Void = { _ in }
    var resolve: (KeyGrid, CGPoint) -> (row: Int, key: Int)? = { grid, point in grid.index(atX: point.x, y: point.y) }
    var globeTarget: ((UIControl) -> Void)?
    var canStartSwipe: () -> Bool = { false }
    var onSwipe: ([SwipeSample], [SwipeKey]) -> Void = { _, _ in }
    var onSwipeStarted: () -> Void = {}
    let swipeTrail = CAShapeLayer()

    private(set) var layout = KeyboardLayout(rows: [])
    private(set) var signature = ""
    private(set) var metrics = KeyboardMetrics.phone(width: 390)
    private(set) var faceContext = KeyFaceContext(device: .phone, layer: .letters, kind: .text, shift: .off, returnKind: .default, returnEnabled: true)
    private(set) var theme = KeyboardTheme.lightCurrent
    private(set) var keyViews: [KeyView] = []
    private(set) var grid = KeyGrid()
    private var rowKeys: [[KeyView]] = []
    private var globeControls: [UIControl] = []
    let callout = CalloutView()
    let alternates = AlternatesView()
    private let expander = ExpanderView()
    private var animatesLayout = false
    var tracked: [ObjectIdentifier: TrackedTouch] = [:]

    var characterPreview = true
    var oneHanded: (key: Key?, current: OneHanded) = (nil, .off)
    var showsCallouts: Bool { characterPreview && faceContext.device == .phone }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        isExclusiveTouch = false
        clipsToBounds = false
        callout.isHidden = true
        alternates.isHidden = true
        expander.isHidden = true
        expander.addAction(UIAction { [unowned self] _ in onEvent(.oneHanded(.off)) }, for: .touchUpInside)
        addSubview(expander)
        addSubview(callout)
        addSubview(alternates)
        swipeTrail.strokeColor = UIColor.systemBlue.withAlphaComponent(0.55).cgColor
        swipeTrail.fillColor = nil
        swipeTrail.lineWidth = 3
        swipeTrail.lineCap = .round
        swipeTrail.lineJoin = .round
        layer.addSublayer(swipeTrail)
    }

    required init?(coder: NSCoder) { fatalError() }

    func update(layout: KeyboardLayout, signature: String, metrics: KeyboardMetrics, faces: KeyFaceContext, theme: KeyboardTheme) {
        let rebuild = layout != self.layout
        let relayout = rebuild || metrics != self.metrics || signature != self.signature || theme != self.theme
        if rebuild {
            animatesLayout = false
        } else if metrics.margin != self.metrics.margin, window != nil {
            animatesLayout = true
        }
        self.layout = layout
        self.signature = signature
        self.metrics = metrics
        self.faceContext = faces
        self.theme = theme

        if rebuild { rebuildKeys() }
        if relayout { setNeedsLayout() }
        refreshFaces()
    }

    private func rebuildKeys() {
        keyViews.forEach { $0.removeFromSuperview() }
        globeControls.forEach { $0.removeFromSuperview() }
        rowKeys = layout.rows.map { row in
            row.compactMap { item -> KeyView? in
                guard case .key(let key) = item else { return nil }
                return KeyView(key: key)
            }
        }
        keyViews = rowKeys.flatMap { $0 }
        keyViews.forEach { insertSubview($0, belowSubview: callout) }
        globeControls = keyViews.filter { $0.key.action == .nextKeyboard }.map { _ in
            let control = UIControl()
            globeTarget?(control)
            addSubview(control)
            return control
        }
        for (_, touch) in tracked { touch.keyView = nil }
        grid = KeyGrid(layout, width: bounds.width, metrics: metrics.grid, signature: signature)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        grid = KeyGrid(layout, width: bounds.width, metrics: metrics.grid, signature: signature)
        onGrid(grid)
        guard animatesLayout else { return placeKeys() }
        animatesLayout = false
        UIView.animate(springDuration: 0.35, bounce: 0, options: .allowUserInteraction) { placeKeys() }
    }

    private func placeKeys() {
        var globes = globeControls.makeIterator()
        for (views, keys) in zip(rowKeys, grid.rows) {
            for (view, key) in zip(views, keys) {
                view.frame = CGRect(key.frame)
                view.layoutIfNeeded()
                if view.key.action == .nextKeyboard { globes.next()?.frame = view.frame }
            }
        }
        if case let (glyph, pointsRight)? = grid.expander {
            expander.place(CGRect(glyph), pointsRight: pointsRight, in: bounds, color: theme.expander.ui)
        }
        expander.isHidden = grid.expander == nil
        refreshFaces()
    }

    private func refreshFaces() {
        for view in keyViews {
            view.theme = theme
            view.configure(KeyFace(view.key, trailing: view.center.x > bounds.midX, context: faceContext), metrics: metrics)
        }
    }

    var drawableBounds: CGRect {
        bounds.inset(by: UIEdgeInsets(top: -frame.minY, left: 0, bottom: 0, right: 0))
    }

    func keyView(at point: CGPoint) -> KeyView? {
        resolve(grid, point).map { rowKeys[$0.row][$0.key] }
    }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        bounds.contains(point)
    }
}

extension CGRect {
    init(_ rect: Rect) {
        self.init(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
    }
}
