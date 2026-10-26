import UIKit
import KeyboardCore

final class KeyView: UIView {
    let key: Key
    private let label = UILabel()
    private let secondaryLabel = UILabel()
    private let cornerLabel = UILabel()
    private let icon = UIImageView()
    private var face = KeyFace(content: .none)
    private var metrics: KeyboardMetrics?

    var theme = KeyboardTheme.lightCurrent { didSet { updateColors() } }
    var isPressed = false { didSet { if isPressed != oldValue { updateColors() } } }
    var showsLabel = true { didSet { contentAlpha = showsLabel ? 1 : 0 } }
    var isFlicked = false {
        didSet {
            guard isFlicked != oldValue, let secondary = face.secondary, case .letter(let primary) = face.content else { return }
            label.text = isFlicked ? secondary : primary
            secondaryLabel.isHidden = isFlicked
            setNeedsLayout()
        }
    }

    private var contentAlpha: CGFloat = 1 {
        didSet { [label, secondaryLabel, cornerLabel, icon].forEach { $0.alpha = contentAlpha } }
    }

    init(key: Key) {
        self.key = key
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        isAccessibilityElement = true
        accessibilityTraits = .keyboardKey
        layer.cornerCurve = .circular
        icon.contentMode = .center
        label.textAlignment = .center
        secondaryLabel.textAlignment = .center
        [secondaryLabel, cornerLabel, label, icon].forEach(addSubview)
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(_ face: KeyFace, metrics: KeyboardMetrics) {
        guard face != self.face || metrics != self.metrics else { return }
        self.face = face
        self.metrics = metrics
        layer.cornerRadius = metrics.cornerRadius

        switch face.content {
        case .letter(let text):
            label.text = text
            label.font = KeyboardFont.letter(metrics.letterSize)
            icon.image = nil
        case .text(let text):
            label.text = text
            label.font = .systemFont(ofSize: metrics.labelSize, weight: .regular)
            icon.image = nil
        case .smallText(let text):
            label.text = text
            label.font = .systemFont(ofSize: metrics.labelSize * 0.75, weight: .regular)
            icon.image = nil
        case .symbol(let name):
            label.text = nil
            let configuration = UIImage.SymbolConfiguration(pointSize: metrics.symbolSize, weight: .regular)
            icon.image = UIImage(systemName: name, withConfiguration: configuration)
        case .none:
            label.text = nil
            icon.image = nil
        }
        accessibilityLabel = accessibilityName
        accessibilityIdentifier = if case .character(let value) = key.action { "hex.\(value)" } else { "hex.\(accessibilityName)" }
        secondaryLabel.text = face.secondary
        cornerLabel.text = face.corner
        cornerLabel.font = .systemFont(ofSize: metrics.secondarySize, weight: .regular)
        if face.secondary != nil, !face.secondaryIsDimmed {
            label.font = .systemFont(ofSize: metrics.pairSize, weight: .regular)
            secondaryLabel.font = label.font
        } else {
            secondaryLabel.font = .systemFont(ofSize: metrics.secondarySize, weight: .regular)
        }
        updateColors()
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let metrics else { return }
        label.sizeToFit()
        icon.sizeToFit()
        layoutCorner(inset: metrics.cornerRadius)

        switch face.alignment {
        case .center:
            let offset = isLetter ? metrics.letterOffset : 0
            label.center = CGPoint(x: bounds.midX, y: bounds.midY + offset)
            icon.center = CGPoint(x: bounds.midX, y: bounds.midY)
        case .bottomLeading, .bottomTrailing:
            let leading = face.alignment == .bottomLeading
            let inset = metrics.edgeInset
            label.frame.origin = CGPoint(
                x: leading ? inset.width : bounds.width - inset.width - label.bounds.width,
                y: bounds.height - metrics.textBaselineInset - (label.font?.ascender ?? 0)
            )
            icon.frame.origin = CGPoint(
                x: leading ? inset.width : bounds.width - inset.width - icon.bounds.width,
                y: bounds.height - inset.height - icon.bounds.height
            )
        }

        guard face.secondary != nil, let font = label.font, let secondaryFont = secondaryLabel.font else {
            return secondaryLabel.frame = .zero
        }
        secondaryLabel.sizeToFit()
        var capTop = metrics.secondaryCapTop
        var baseline = bounds.height - metrics.letterBaselineInset
        if !face.secondaryIsDimmed {
            capTop = metrics.pairCapTop
            baseline = bounds.height * (1 - metrics.pairBaselineRatio)
        }
        secondaryLabel.frame.origin = CGPoint(
            x: bounds.midX - secondaryLabel.bounds.width / 2,
            y: capTop - (secondaryFont.ascender - secondaryFont.capHeight)
        )
        label.frame.origin = CGPoint(x: bounds.midX - label.bounds.width / 2, y: baseline - font.ascender)
    }

    private func layoutCorner(inset: CGFloat) {
        guard face.corner != nil, let font = cornerLabel.font else { return cornerLabel.frame = .zero }
        cornerLabel.sizeToFit()
        cornerLabel.frame.origin = CGPoint(x: bounds.width - inset - cornerLabel.bounds.width, y: inset - (font.ascender - font.capHeight))
    }

    private var accessibilityName: String {
        switch key.action {
        case .character: label.text ?? ""
        case .space: "space"
        case .delete: "delete"
        case .shift: "shift"
        case .capsLock: "caps lock"
        case .return: label.text ?? "return"
        case .tab: "tab"
        case .layer(.letters): "letters"
        case .layer(.numbers): "numbers"
        case .layer(.symbols): "symbols"
        case .nextKeyboard: "next keyboard"
        case .dismiss: "dismiss keyboard"
        }
    }

    private var isLetter: Bool {
        if case .letter = face.content { true } else { false }
    }

    private func updateColors() {
        let prominent = face.isProminent
        backgroundColor = prominent ? theme.prominent.ui : isPressed ? theme.keyPressed.ui : theme.key.ui
        let foreground = prominent ? theme.prominentLabel.ui : theme.label.ui
        label.textColor = foreground
        icon.tintColor = foreground
        secondaryLabel.textColor = face.secondaryIsDimmed ? theme.secondaryLabel.ui : foreground
        cornerLabel.textColor = theme.secondaryLabel.ui
    }
}
