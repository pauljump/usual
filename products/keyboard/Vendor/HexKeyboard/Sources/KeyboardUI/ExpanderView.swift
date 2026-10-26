import UIKit
import KeyboardCore

/// The chevron in a one-handed keyboard's margin that brings both hands back.
final class ExpanderView: UIControl {
    private let chevron = CAShapeLayer()
    private var drawn = CGRect.null

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityLabel = "Full keyboard"
        accessibilityIdentifier = "hex.expand"
        chevron.fillColor = nil
        chevron.lineWidth = 16.0 / 3
        chevron.lineCap = .round
        chevron.lineJoin = .round
        layer.addSublayer(chevron)
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Draws the chevron at `glyph` (in the superview) and takes taps in the column around it, down the keyboard.
    func place(_ glyph: CGRect, pointsRight: Bool, in bounds: CGRect, color: UIColor) {
        let column = max(44, glyph.width)
        let minX = pointsRight ? glyph.midX - column / 2 : bounds.minX
        let maxX = pointsRight ? bounds.maxX : glyph.midX + column / 2
        frame = CGRect(x: minX, y: bounds.minY, width: maxX - minX, height: bounds.height)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        chevron.strokeColor = color.cgColor
        let local = glyph.offsetBy(dx: -frame.minX, dy: -frame.minY).insetBy(dx: chevron.lineWidth / 2, dy: chevron.lineWidth / 2)
        guard local != drawn else { return }
        drawn = local
        let path = UIBezierPath()
        let (tip, tail) = pointsRight ? (local.maxX, local.minX) : (local.minX, local.maxX)
        path.move(to: CGPoint(x: tail, y: local.minY))
        path.addLine(to: CGPoint(x: tip, y: local.midY))
        path.addLine(to: CGPoint(x: tail, y: local.maxY))
        chevron.path = path.cgPath
    }
}
